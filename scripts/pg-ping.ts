/**
 * Can this server reach Postgres? Read-only: connects with DATABASE_URL the way the app
 * does (src/db/rdsConnection.ts) and prints who it is, the TLS it got, and a few counts.
 * Changes nothing.
 *
 *   npm run pg:ping            (on Render: the service → Shell)
 *
 * Exit 0 = connected; 1 = not, with the reason. From a computer that isn't one of the
 * addresses aws-infra lets in (database.publicAccess.allowFrom), it times out — that's
 * the lock working.
 */
import pg from 'pg';
import { iamPoolConfig, iamTargetFrom } from '../src/db/rdsConnection.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const target = iamTargetFrom(url, process.env.AWS_REGION);
const config = target ? await iamPoolConfig(target) : { connectionString: url, connectionTimeoutMillis: 10_000 };
const where = target ? `${target.user}@${target.host}:${target.port}/${target.database} (IAM token)` : 'DATABASE_URL';
console.log(`Connecting to ${where} …`);

const client = new pg.Client(config);
const started = Date.now();
try {
  await client.connect();
  const ms = Date.now() - started;
  const me = await client.query(
    `SELECT current_user AS "user", current_database() AS db, s.ssl, s.version AS tls, current_setting('server_version') AS server
       FROM pg_stat_ssl s WHERE s.pid = pg_backend_pid()`,
  );
  const tables = await client.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`);
  const round = Date.now();
  await client.query('SELECT 1');
  const roundMs = Date.now() - round;
  const row = me.rows[0];
  console.log(`Connected in ${ms} ms as ${row.user} to ${row.db} (PostgreSQL ${row.server}).`);
  console.log(`TLS: ${row.ssl ? row.tls : 'OFF'} · one query round trip: ${roundMs} ms · tables in public: ${tables.rows[0].n}`);
  const customers = await client.query(`SELECT to_regclass('public.customers') IS NOT NULL AS present`);
  if (customers.rows[0].present) {
    const n = await client.query('SELECT count(*)::int AS n FROM customers');
    console.log(`customers: ${n.rows[0].n} rows`);
  }
  await client.end();
} catch (err) {
  const e = err as Error & { code?: string };
  console.error(`Not connected after ${Date.now() - started} ms: ${e.code ? `${e.code} ` : ''}${e.message}`);
  if (/timeout|ETIMEDOUT/i.test(e.message)) console.error('A timeout usually means this address is not in allowFrom, or the database is not public yet.');
  if (/PAM authentication failed/i.test(e.message)) console.error('The AWS key may lack rds-db:connect for this user (aws-infra websiteUserCanConnect), or the user is wrong.');
  await client.end().catch(() => {});
  process.exit(1);
}
