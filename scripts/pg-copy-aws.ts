/**
 * Copy MongoDB into the RDS Postgres on AWS (every area), or check it —
 * pg-copy.ts for a database a laptop can't reach. MongoDB is only READ.
 *
 *   node scripts/pg-copy-aws.ts --deploy             upload the copy Lambda's code (after a change to src/db)
 *   node scripts/pg-copy-aws.ts                      dry run: map and report, write nothing
 *   node scripts/pg-copy-aws.ts --write              replace the copied tables in one transaction
 *   node scripts/pg-copy-aws.ts --verify             compare Postgres with MongoDB row by row
 *   node scripts/pg-copy-aws.ts --verify --scope customers   only the customer area's tables (cutover: the rest is still live on MongoDB)
 *   --scope operations   with --write / --verify / --lock: Payments, Check In + Selection Sheet and Daily Reports tables (their one cutover)
 *   --scope deliveries   with --write / --verify / --lock: only the deliveries and trucks tables (its own cutover; customers stay untouched)
 *   node scripts/pg-copy-aws.ts --lock "name"        at cutover: refuse every copy from now on
 *   --report <file>   save the full report (every problem, by id) here
 *
 * How (no NAT, no EC2): this reads MongoDB, puts a snapshot in the copy bucket,
 * runs the copy Lambda inside the VPC (it reads the snapshot and writes RDS), and
 * deletes the snapshot when the run ends (the bucket forgets anything left after a day).
 *
 * MONGO_URI    the source (the live database is fine: reads only).
 * PG_COPY_ENV  dev (default) | staging | prod — names the function (aws-infra output
 *              MongoCopyFunction); the function names its bucket.
 * AWS credentials: the default profile (~/.aws), region us-east-2 unless AWS_REGION.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LambdaClient, InvokeCommand, UpdateFunctionCodeCommand, GetFunctionConfigurationCommand, waitUntilFunctionUpdatedV2 } from '@aws-sdk/client-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { readMongo } from '../src/db/copy/readMongo.ts';
import { packSnapshot } from '../src/db/aws/snapshot.ts';
import type { CopyAction, CopyEvent, CopyResult } from '../src/db/aws/copyHandler.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const valueOf = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const region = process.env.AWS_REGION || 'us-east-2';
const envName = process.env.PG_COPY_ENV || 'dev';
const functionName = `easy-surfaces-${envName}-db-copy`;
const action: CopyAction | null = flag('--lock') ? 'lock' : flag('--verify') ? 'verify' : flag('--write') ? 'write'
  : flag('--deploy') && !flag('--dry-run') ? null : 'dry-run';

const lambda = new LambdaClient({ region, requestHandler: { requestTimeout: 15 * 60_000 } });
const s3 = new S3Client({ region });

/** Bundle the handler + the migrations into a zip and make it the function's code. */
async function deploy(): Promise<void> {
  const { build } = await import('esbuild');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-copy-lambda-'));
  try {
    await build({
      entryPoints: [path.join(ROOT, 'src/db/aws/copyHandler.ts')],
      outfile: path.join(dir, 'index.mjs'),
      bundle: true, platform: 'node', target: 'node24', format: 'esm', sourcemap: 'inline', minify: true,
      // pg and the MongoDB driver are CommonJS and call require().
      banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
      // Optional add-ons of pg / mongodb that this never uses.
      external: ['pg-native', 'kerberos', '@mongodb-js/zstd', 'snappy', 'socks', 'aws4', 'mongodb-client-encryption', 'gcp-metadata', '@aws-sdk/credential-providers'],
      logLevel: 'warning'
    });
    fs.cpSync(path.join(ROOT, 'drizzle'), path.join(dir, 'drizzle'), { recursive: true });
    execFileSync('zip', ['-qr', 'code.zip', 'index.mjs', 'drizzle'], { cwd: dir });
    const zip = fs.readFileSync(path.join(dir, 'code.zip'));
    await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: functionName, ZipFile: zip }));
    await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 300 }, { FunctionName: functionName });
    console.log(`Deployed ${functionName} (${(zip.length / 1024 / 1024).toFixed(1)} MB).`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function run(what: CopyAction): Promise<CopyResult> {
  // The function names its own bucket (aws-infra sets COPY_BUCKET).
  const fnConfig = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: functionName }));
  const bucket = fnConfig.Environment?.Variables?.COPY_BUCKET;
  if (!bucket) throw new Error(`${functionName} has no COPY_BUCKET: is the aws-infra database stack deployed?`);
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${what}`;
  const event: CopyEvent = { action: what, runId, ...(['customers', 'deliveries', 'operations'].includes(valueOf('--scope') ?? '') ? { scope: valueOf('--scope') as 'customers' | 'deliveries' | 'operations' } : {}) };
  let snapshotKey: string | undefined;
  try {
    if (what === 'lock') {
      event.lockedBy = valueOf('--lock');
      if (!event.lockedBy || event.lockedBy.startsWith('--')) throw new Error('--lock needs a name: who is locking it.');
    } else {
      const mongoUri = process.env.MONGO_URI;
      if (!mongoUri) throw new Error('MONGO_URI is not set.');
      const body = packSnapshot(await readMongo(mongoUri, 'pg-copy-aws'));
      snapshotKey = `snapshots/${runId}.json.gz`;
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: snapshotKey, Body: body, ContentType: 'application/gzip' }));
      event.snapshotKey = snapshotKey;
      console.log(`Read MongoDB → snapshot ${(body.length / 1024 / 1024).toFixed(1)} MB.`);
    }
    const out = await lambda.send(new InvokeCommand({ FunctionName: functionName, Payload: Buffer.from(JSON.stringify(event)) }));
    const payload = JSON.parse(Buffer.from(out.Payload ?? []).toString('utf8') || 'null');
    if (out.FunctionError) throw new Error(`The copy Lambda failed: ${payload?.errorMessage ?? out.FunctionError}`);
    const result = payload as CopyResult;
    const reportFile = valueOf('--report');
    if (reportFile && result.reportKey) {
      const report = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: result.reportKey }));
      fs.writeFileSync(reportFile, await report.Body!.transformToString());
      console.log(`Full report: ${reportFile}`);
    }
    return result;
  } finally {
    if (snapshotKey) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: snapshotKey }));
  }
}

function print(r: CopyResult): void {
  if (r.error) console.error(r.error);
  if (r.action === 'lock' && r.ok) console.log('Locked: this database will refuse every copy from MongoDB from now on.');
  if (r.action === 'verify') {
    console.log(r.diffs?.length ? r.diffs.join('\n') : 'Verified: Postgres on AWS matches MongoDB, every table, every row, every column.');
  }
  if (r.action === 'write' || r.action === 'dry-run') {
    console.log(r.action === 'write' ? 'Copied.' : 'Dry run — nothing written.');
    console.log('\nMongoDB records read:'); console.table(r.source);
    console.log('Postgres rows:'); console.table(r.tables);
    console.log(`Problems (${r.problemCount}), by kind:`);
    for (const [k, n] of Object.entries(r.summary ?? {})) console.log(`  ${String(n).padStart(5)}  ${k}`);
  }
  console.log(`\n${r.seconds}s in the Lambda`);
}

if (flag('--deploy')) await deploy();
if (action) {
  const result = await run(action);
  print(result);
  process.exitCode = result.ok ? 0 : 1;
}
