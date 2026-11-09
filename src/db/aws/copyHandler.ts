/**
 * The copy Lambda (aws-infra: `<project>-<env>-db-copy`, in the VPC, no internet).
 * Loads a MongoDB snapshot from S3 into Postgres, checks one, or locks the database
 * against copies — the same steps as scripts/pg-copy-customers.ts, run where RDS is.
 * Started by scripts/pg-copy-aws.ts, which also uploads this code (`--deploy`).
 *
 * Logs in as the IAM-auth user (a token signed here, no password, no Secrets Manager).
 * S3 is reached through the VPC's gateway endpoint.
 */
import path from 'node:path';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Signer } from '@aws-sdk/rds-signer';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '../schema/index.ts';
import { copyCustomerArea, verifyCustomerArea, lockCopies, CopyLockedError, type Db } from '../copy/customerArea.ts';
import { unpackSnapshot } from './snapshot.ts';

export type CopyAction = 'dry-run' | 'write' | 'verify' | 'lock';

export interface CopyEvent {
  action: CopyAction;
  runId: string;
  /** S3 key of the snapshot (every action but lock). */
  snapshotKey?: string;
  /** lock: who is locking it. */
  lockedBy?: string;
}

export interface CopyResult {
  ok: boolean;
  action: CopyAction;
  error?: string;
  /** write / dry-run: */
  source?: Record<string, number>;
  tables?: Record<string, number>;
  summary?: Record<string, number>;
  problemCount?: number;
  /** verify: differences, empty = equal. */
  diffs?: string[];
  /** The full report (every problem, by id) in the bucket. */
  reportKey?: string;
  seconds: number;
}

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};

export const handler = async (event: CopyEvent): Promise<CopyResult> => {
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 100) / 10;
  const bucket = env('COPY_BUCKET');
  const s3 = new S3Client({});
  const host = env('DB_HOST');
  const port = Number(env('DB_PORT'));
  const user = env('DB_USER');
  const signer = new Signer({ hostname: host, port, username: user, region: process.env.AWS_REGION });
  const pool = new pg.Pool({
    host, port, user, database: env('DB_NAME'),
    password: () => signer.getAuthToken(),
    ssl: { rejectUnauthorized: true }, // the RDS CA, from NODE_EXTRA_CA_CERTS
    max: 2,
    connectionTimeoutMillis: 10_000
  });
  const db = drizzle(pool, { schema, casing: 'snake_case' }) as unknown as Db;
  try {
    await migrate(db as never, { migrationsFolder: path.join(process.env.LAMBDA_TASK_ROOT || '.', 'drizzle') });

    if (event.action === 'lock') {
      if (!event.lockedBy) throw new Error('lock needs lockedBy: who is locking it.');
      await lockCopies(db, event.lockedBy);
      return { ok: true, action: 'lock', seconds: seconds() };
    }

    if (!event.snapshotKey) throw new Error('snapshotKey is missing.');
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: event.snapshotKey }));
    const src = unpackSnapshot(await object.Body!.transformToByteArray());
    const reportKey = `reports/${event.runId}.json`;
    const saveReport = (body: unknown) =>
      s3.send(new PutObjectCommand({ Bucket: bucket, Key: reportKey, Body: JSON.stringify(body, null, 1), ContentType: 'application/json' }));

    if (event.action === 'verify') {
      const diffs = await verifyCustomerArea(db, src);
      await saveReport({ verifiedAt: new Date().toISOString(), diffs });
      return { ok: diffs.length === 0, action: 'verify', diffs: diffs.slice(0, 200), reportKey, seconds: seconds() };
    }

    const report = await copyCustomerArea(db, src, { write: event.action === 'write' });
    await saveReport(report);
    return {
      ok: true, action: event.action,
      source: report.source, tables: report.tables, summary: report.summary, problemCount: report.problems.length,
      reportKey, seconds: seconds()
    };
  } catch (err) {
    // A lock is an answer, not a crash: the database holds live data.
    if (err instanceof CopyLockedError) return { ok: false, action: event.action, error: err.message, seconds: seconds() };
    throw err;
  } finally {
    await pool.end();
  }
};
