/**
 * How the website reaches RDS from outside AWS (Render; owner, 2026-11-08).
 *
 *   DATABASE_URL=postgres://app_iam@<endpoint>:5432/app?auth=iam
 *
 * `auth=iam`: no password exists. Each new connection signs a 15-minute IAM token with the
 * AWS key the server already holds for S3 (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY of
 * `easy-surfaces-<env>-files-uploader`, which aws-infra lets connect as `app_iam`).
 * TLS always checks the server against Amazon's RDS certificates (rds-ca/global-bundle.pem,
 * from truststore.pki.rds.amazonaws.com) — never `rejectUnauthorized: false`.
 *
 * Any other postgres:// URL is passed to pg unchanged (a local database, sslmode in the URL).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'rds-ca', 'global-bundle.pem');

export interface IamTarget {
  host: string;
  port: number;
  user: string;
  database: string;
  region: string;
}

/** Reads an `auth=iam` URL; null for any other URL. Throws on a half-written one. */
export function iamTargetFrom(url: string, fallbackRegion?: string): IamTarget | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.searchParams.get('auth') !== 'iam') return null;
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) throw new Error('DATABASE_URL with auth=iam must be postgres://');
  if (parsed.password) throw new Error('DATABASE_URL with auth=iam must not hold a password (it signs IAM tokens)');
  const user = decodeURIComponent(parsed.username);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!user) throw new Error('DATABASE_URL with auth=iam needs the user, e.g. postgres://app_iam@…');
  if (!database) throw new Error('DATABASE_URL with auth=iam needs the database name, e.g. …:5432/app');
  const region = /\.([a-z]{2}(-gov)?-[a-z]+-\d)\.rds\.amazonaws\.com$/.exec(parsed.hostname)?.[1] ?? fallbackRegion;
  if (!region) throw new Error('DATABASE_URL with auth=iam: no region in the host name and no AWS_REGION');
  return { host: parsed.hostname, port: Number(parsed.port || 5432), user, database, region };
}

let ca: string | undefined;
/** Amazon's RDS root and regional certificates (read once). */
export function rdsCa(): string {
  return (ca ??= readFileSync(CA_FILE, 'utf8'));
}

/** pg Pool settings for an IAM target: a fresh token per connection, verified TLS. */
export async function iamPoolConfig(target: IamTarget) {
  const { Signer } = await import('@aws-sdk/rds-signer');
  const signer = new Signer({ hostname: target.host, port: target.port, username: target.user, region: target.region });
  return {
    host: target.host,
    port: target.port,
    user: target.user,
    database: target.database,
    password: () => signer.getAuthToken(),
    ssl: { ca: rdsCa(), rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
  };
}
