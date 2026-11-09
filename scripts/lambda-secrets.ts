/**
 * Fill the Lambda's app secret (`easy-surfaces/<env>/app`, us-east-2) from an env file.
 *
 *   node scripts/lambda-secrets.ts --from <env file> --relay-url https://<render host>/api/internal/relay [--env dev] [--dry-run] [--keep KEY,KEY]
 *
 * Keeps only the keys the server reads at run time (SERVER_KEYS — checked against the
 * code by scripts/lambda-secrets.test.ts), drops the rest (PORT, NODE_ENV, RENDER_*,
 * VITE_*, local-only and job-only keys, and AWS credentials: Lambda's role supplies its
 * own, and a static key merged over them would be paired with the role's session token
 * and break every AWS call). Adds FORWARD_SECRET / RELAY_SECRET — taken from the file
 * when it has them, else generated and printed ONCE so the same values can be put on
 * Render — and RELAY_URL. Then PutSecretValue with the whole JSON object: a new
 * AWSCURRENT version that replaces everything before it (CDK creates the secret as
 * {"placeholder":"<random>"}; nothing of that is kept).
 *
 * --dry-run prints key names only and calls nothing. Credentials for the real run come
 * from the usual AWS chain (AWS_PROFILE, SSO, env); no values are ever printed except
 * newly generated FORWARD_SECRET / RELAY_SECRET.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REGION = 'us-east-2';
export const secretIdFor = (env: string) => `easy-surfaces/${env}/app`;

/** Every key the server (server.ts and what it imports) reads at run time, minus the ones below. */
export const SERVER_KEYS = [
  'MONGO_URI', 'JWT_SECRET', 'FRONTEND_URL',
  // mail (src/services/emailService.ts)
  'SES_FROM_EMAIL', 'SES_CONFIGURATION_SET', 'SES_REGION',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS',
  'CHECKIN_ALERT_EMAIL', 'CONTACT_ALERT_EMAIL',
  // Google: calendar sign-in, translation, geocoding
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_TRANSLATE_API_KEY', 'GOOGLE_GEOCODING_API_KEY', 'GOOGLE_MAPS_API_KEY',
  // files (src/services/fileStore.ts)
  'FILE_STORE', 'FILES_BUCKET', 'FILES_CDN_URL', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET',
  // StoneProfits ERP import, freight start date
  'ERP_URL', 'ERP_USERNAME', 'ERP_PASSWORD', 'FREIGHT_CHARGES_FROM'
] as const;

/** Read by the code but never sent to Lambda, and why. */
export const DROPPED_ON_PURPOSE: Record<string, string> = {
  PORT: 'Lambda has no port',
  NODE_ENV: 'set on the function itself',
  PATH: 'the runtime\'s own',
  JOBS: 'Render runs the timers',
  DAILY_REPORT_AUTO_SUBMIT: 'job only (Render)',
  LAMBDA_API_URL: 'Render\'s forwarder',
  LAMBDA_ROUTES: 'Render\'s forwarder',
  LAMBDA_TASK_ROOT: 'set by Lambda',
  RUNTIME: 'set on the function itself',
  MODULE: 'set on the function itself',
  APP_SECRET_ARN: 'set on the function itself',
  AWS_REGION: 'reserved — Lambda sets it',
  AWS_DEFAULT_REGION: 'reserved — Lambda sets it',
  AWS_ACCESS_KEY_ID: 'the function\'s role supplies credentials',
  AWS_SECRET_ACCESS_KEY: 'the function\'s role supplies credentials',
  AWS_SESSION_TOKEN: 'the function\'s role supplies credentials',
  AWS_PROFILE: 'local only',
  TARGET_MONGO_URI: 'copy-database script only',
  TARGET_MONGO_USER: 'copy-database script only',
  TARGET_MONGO_PASSWORD: 'copy-database script only'
};
/** Prefixes dropped whatever follows. */
export const DROPPED_PREFIXES = ['RENDER_', 'VITE_', 'AWS_LAMBDA_', 'npm_'];

export const ADDED_KEYS = ['FORWARD_SECRET', 'RELAY_SECRET', 'RELAY_URL'] as const;

/** A dotenv-style file → { KEY: value }. Comments, blank lines, `export `, quotes, \n in "…". */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/^\s*export\s+/, '');
    const m = /^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    const quote = value[0];
    if (quote === '"' || quote === '\'' || quote === '`') {
      // A quoted value may run over several lines until its closing quote.
      let rest = value.slice(1);
      while (!new RegExp(`(^|[^\\\\])${quote}\\s*(#.*)?$`).test(rest) && i + 1 < lines.length) rest += `\n${lines[++i]}`;
      const end = rest.lastIndexOf(quote);
      value = end === -1 ? rest : rest.slice(0, end);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    out[key] = value;
  }
  return out;
}

export interface Plan {
  secret: Record<string, string>;
  kept: string[];
  dropped: string[];
  generated: string[];
  missing: string[];  // SERVER_KEYS the file doesn't have (fine for optional ones)
  warnings: string[];
}

export function planSecret(env: Record<string, string>, { relayUrl, keep = [], random = () => crypto.randomBytes(32).toString('base64url') }: { relayUrl: string; keep?: string[]; random?: () => string }): Plan {
  if (!relayUrl) throw new Error('--relay-url is required (https://<render host>/api/internal/relay).');
  let url: URL;
  try { url = new URL(relayUrl); } catch { throw new Error('--relay-url is not a URL.'); }
  const warnings: string[] = [];
  if (url.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) warnings.push('RELAY_URL is not https.');
  if (!url.pathname.endsWith('/api/internal/relay')) warnings.push('RELAY_URL does not end in /api/internal/relay.');

  const allowed = new Set<string>([...SERVER_KEYS, ...keep]);
  const secret: Record<string, string> = {};
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (ADDED_KEYS.includes(key as typeof ADDED_KEYS[number])) continue;
    if (allowed.has(key) && value !== '') { secret[key] = value; kept.push(key); } else dropped.push(key);
  }
  const generated: string[] = [];
  for (const key of ['FORWARD_SECRET', 'RELAY_SECRET']) {
    if (env[key]) secret[key] = env[key];
    else { secret[key] = random(); generated.push(key); }
  }
  secret.RELAY_URL = relayUrl;
  const missing = SERVER_KEYS.filter((k) => !(k in secret));
  for (const k of ['MONGO_URI', 'JWT_SECRET']) if (!secret[k]) throw new Error(`${k} is missing from the env file — the server can't start without it.`);
  if (!secret.FRONTEND_URL) warnings.push('FRONTEND_URL is not set: links in emails sent from Lambda fall back to the request origin only (Render\'s RENDER_EXTERNAL_URL is not copied).');
  if (/localhost|127\.0\.0\.1/.test(secret.MONGO_URI)) warnings.push('MONGO_URI points at this machine — Lambda can\'t reach it.');
  if (Buffer.byteLength(JSON.stringify(secret)) > 65536) throw new Error('The secret is over Secrets Manager\'s 64 KB limit.');
  return { secret, kept: kept.sort(), dropped: dropped.sort(), generated, missing, warnings };
}

/** Why a dropped key was dropped (for the listing). */
export const dropReason = (key: string) =>
  DROPPED_ON_PURPOSE[key] || (DROPPED_PREFIXES.find((p) => key.startsWith(p)) ? `${DROPPED_PREFIXES.find((p) => key.startsWith(p))}* not used by the server` : 'not read by the server (pass --keep to send it)');

function argValue(argv: string[], name: string) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

/** Secrets Manager PutSecretValue, signed with SigV4 (no Secrets Manager SDK in the app). */
export async function putSecretValue(secretId: string, secretString: string, {
  credentials, fetchImpl = fetch
}: { credentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string }; fetchImpl?: typeof fetch } = {}) {
  const { SignatureV4 } = await import('@smithy/signature-v4');
  type Data = string | ArrayBuffer | ArrayBufferView;
  const bytes = (d: Data) => typeof d === 'string' ? d : d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  class Sha256 {
    private hash: crypto.Hash | crypto.Hmac;
    constructor(secret?: Data) { this.hash = secret ? crypto.createHmac('sha256', bytes(secret)) : crypto.createHash('sha256'); }
    update(data: Data) { this.hash.update(bytes(data)); }
    async digest() { return new Uint8Array(this.hash.digest()); }
    reset() { /* one use each */ }
  }
  const host = `secretsmanager.${REGION}.amazonaws.com`;
  const body = JSON.stringify({ SecretId: secretId, SecretString: secretString, ClientRequestToken: crypto.randomUUID() });
  const signer = new SignatureV4({ service: 'secretsmanager', region: REGION, credentials: credentials ?? (await import('@aws-sdk/credential-provider-node')).defaultProvider(), sha256: Sha256 });
  const signed = await signer.sign({
    method: 'POST', protocol: 'https:', hostname: host, path: '/', query: {},
    headers: { host, 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'secretsmanager.PutSecretValue' },
    body
  });
  // fetch sets host itself (to the same value it was signed with).
  const { host: _signedHost, ...headers } = signed.headers as Record<string, string>;
  const res = await fetchImpl(`https://${host}/`, { method: 'POST', headers, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`PutSecretValue failed (${res.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text) as { ARN: string; VersionId: string };
}

export async function main(argv = process.argv.slice(2)) {
  const from = argValue(argv, '--from');
  const relayUrl = argValue(argv, '--relay-url') || '';
  const env = argValue(argv, '--env') || 'dev';
  const dryRun = argv.includes('--dry-run');
  const keep = (argValue(argv, '--keep') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!from) throw new Error('usage: node scripts/lambda-secrets.ts --from <env file> --relay-url <url> [--env dev] [--dry-run] [--keep KEY,KEY]');
  if (!/^[a-z0-9-]+$/.test(env)) throw new Error('--env must be like dev / prod.');

  const plan = planSecret(parseEnvFile(fs.readFileSync(path.resolve(from), 'utf8')), { relayUrl, keep });
  const secretId = secretIdFor(env);
  console.log(`Secret ${secretId} (${REGION})${dryRun ? ' — DRY RUN, nothing sent' : ''}\n`);
  console.log(`Kept (${plan.kept.length}): ${plan.kept.join(', ') || '—'}`);
  console.log(`Added: ${ADDED_KEYS.join(', ')}${plan.generated.length ? ` (${plan.generated.join(', ')} ${dryRun ? 'would be' : ''} generated)` : ''}`);
  console.log(`Dropped (${plan.dropped.length}):`);
  for (const k of plan.dropped) console.log(`  ${k} — ${dropReason(k)}`);
  if (plan.missing.length) console.log(`Not in the file (optional unless that feature is used on Lambda): ${plan.missing.join(', ')}`);
  for (const w of plan.warnings) console.log(`⚠ ${w}`);
  if (dryRun) return plan;

  const result = await putSecretValue(secretId, JSON.stringify(plan.secret));
  console.log(`\nSaved ${secretId}, version ${result.VersionId}.`);
  if (plan.generated.length) {
    console.log('\nNew values — put EXACTLY these on Render (Environment) too, then redeploy Render. They are shown once:');
    for (const k of plan.generated) console.log(`  ${k}=${plan.secret[k]}`);
    console.log('Render needs FORWARD_SECRET (its forwarder sends it) and RELAY_SECRET (its relay checks it). Next time pass a file that already has them, or they change.');
  }
  console.log('A running Lambda reads the secret at cold start: publish a new version or update its configuration to pick this up.');
  return plan;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((err) => {
    console.error((err as Error).message || err);
    process.exit(1);
  });
}
