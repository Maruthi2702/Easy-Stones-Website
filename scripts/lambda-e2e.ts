/**
 * End-to-end check of the Lambda move for one module (Permits) against a LOCAL MongoDB
 * copy — never the live database (the env file's MONGO_URI must be on this machine).
 *
 *   node scripts/lambda-e2e.ts --env-file <env file> [--mode full|direct] [--runs 3]
 *        [--handler src/lambda/handler.ts] [--no-contractor]
 *
 * Starts, each with the env file only (the worktree's .env is blanked out under it):
 *   :3101  scripts/lambda-local.ts serving the handler (RUNTIME=lambda, MODULE=permits,
 *          no APP_SECRET_ARN, routes like aws-infra's `ANY /api/permits[/{proxy+}]`)
 *   :3002  "plain" Render: node server.ts with LAMBDA_ROUTES empty (serves Permits itself)
 *   :3001  "forwarding" Render (--mode full only): LAMBDA_API_URL=http://localhost:3101,
 *          LAMBDA_ROUTES=/api/permits,!/api/permits/refresh
 * then, signed in as a staff login whose role holds view_permits + export_permits
 * (a token made exactly as sign-in makes it: signStaffSession, cookie customerToken):
 *   - every Permits GET (meta, list, filtered list, export, export.pdf, contractor/:license,
 *     a 401 without a token, a Bearer header) on plain Render vs. the emulator called
 *     directly with the headers the forwarder adds, and (full) vs. forwarding Render;
 *     status, content-type and body compared (see IGNORED below for what may differ);
 *   - :3101 without x-forward-secret → 403;
 *   - (full) POST /api/permits/refresh is not forwarded (the emulator never sees it);
 *   - timings: cold start, then the median of --runs for each path.
 * Every process it starts is stopped at the end. Exit 1 if a check fails.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MongoClient } from 'mongodb';
import { parseEnvFile } from './lambda-secrets.ts';
import { signStaffSession } from '../src/services/staffSession.ts';
import { PERMITS } from '../src/permits/permissions.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EMULATOR_PORT = 3101;
const FORWARD_PORT = 3001;
const PLAIN_PORT = 3002;
const LAMBDA_ROUTES = '/api/permits,!/api/permits/refresh';
const MAIL_KEY = /^(SMTP_|SES_|GMAIL|RESEND|SENDGRID|MAILGUN|POSTMARK)/;

/** Body fields that may differ between two servers, and why. */
export const IGNORED: Record<string, { paths: RegExp[]; why: string }> = {
  meta: {
    paths: [/^running$/, /^sources(\.\d+)?$/, /^sources\.\d+\.(lastRun|lastOk)\./],
    why: '`running` and which sources are listed come from the pull timer, which runs on Render only (Lambda answers for every source); a run row can change if a pull ran in between'
  },
  pdf: { paths: [/.*/], why: 'the PDF carries its "Generated <minute>" line and a creation date; compared by size (±2%), %PDF header and page count' },
  contractor: { paths: [/^(refreshedAt|insurance|bonds|principals|status|expires|updated)/], why: 'read live from the WA L&I registry on each call' }
};

interface Started { name: string; child: ChildProcess; lines: string[] }
const started: Started[] = [];

function argValue(argv: string[], name: string) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

/** The env each child gets: the env file only, and every other key of the worktree's .env blanked (server.ts's dotenv.config() never overrides a key that is set). */
export function childEnv(fileEnv: Record<string, string>, worktreeEnvKeys: string[], extra: Record<string, string>) {
  const env: Record<string, string> = {};
  for (const k of ['PATH', 'HOME', 'TMPDIR', 'LANG']) if (process.env[k]) env[k] = process.env[k]!;
  for (const k of worktreeEnvKeys) env[k] = '';
  Object.assign(env, fileEnv, extra);
  return env;
}

export function assertSafe(fileEnv: Record<string, string>) {
  const uri = fileEnv.MONGO_URI || '';
  let hosts = '';
  try { hosts = uri.replace(/^mongodb(\+srv)?:\/\//, '').split('/')[0].split('@').pop() || ''; } catch { /* checked below */ }
  if (!/^mongodb:\/\//.test(uri) || !hosts.split(',').every((h) => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h))) {
    throw new Error('Refusing: the env file\'s MONGO_URI is not a database on this machine.');
  }
  const mail = Object.keys(fileEnv).filter((k) => MAIL_KEY.test(k) && fileEnv[k]);
  if (mail.length) throw new Error(`Refusing: the env file has mail settings (${mail.join(', ')}) — remove them so nothing can be emailed.`);
  if (!fileEnv.JWT_SECRET) throw new Error('The env file has no JWT_SECRET.');
}

function start(name: string, args: string[], env: Record<string, string>): Started {
  const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const s: Started = { name, child, lines: [] };
  const take = (buf: Buffer) => { for (const l of buf.toString().split('\n')) if (l.trim()) s.lines.push(l); };
  child.stdout!.on('data', take);
  child.stderr!.on('data', take);
  started.push(s);
  return s;
}

async function stopAll() {
  await Promise.all(started.map((s) => new Promise<void>((resolve) => {
    if (s.child.exitCode !== null || s.child.signalCode) return resolve();
    const t = setTimeout(() => { s.child.kill('SIGKILL'); resolve(); }, 5000);
    s.child.once('exit', () => { clearTimeout(t); resolve(); });
    s.child.kill('SIGTERM');
  })));
}

async function waitFor(s: Started, url: string, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (s.child.exitCode !== null) throw new Error(`${s.name} exited (${s.child.exitCode}):\n${s.lines.slice(-30).join('\n')}`);
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.status < 500 || r.status === 503) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${s.name} didn't answer ${url} in ${timeoutMs / 1000}s:\n${s.lines.slice(-30).join('\n')}`);
}

interface Answer { status: number; type: string; headers: Record<string, string>; body: Buffer; ms: number }

async function call(base: string, p: string, { headers = {}, method = 'GET' }: { headers?: Record<string, string>; method?: string } = {}): Promise<Answer> {
  const t = performance.now();
  const r = await fetch(base + p, { method, headers: { 'accept-encoding': 'gzip, br', ...headers }, redirect: 'manual', signal: AbortSignal.timeout(60_000) });
  const body = Buffer.from(await r.arrayBuffer());
  const h: Record<string, string> = {};
  r.headers.forEach((v, k) => { h[k] = v; });
  return { status: r.status, type: r.headers.get('content-type') || '', headers: h, body, ms: Math.round(performance.now() - t) };
}

/** Paths where two JSON values differ (a.b.0.c). */
export function jsonDiff(a: unknown, b: unknown, at = '', out: string[] = []): string[] {
  if (out.length > 50) return out;
  if (a === b) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) { out.push(at || '(root)'); return out; }
    if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) out.push(at || '(root)');
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) jsonDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], at ? `${at}.${k}` : k, out);
    return out;
  }
  out.push(at || '(root)');
  return out;
}

const pdfPages = (b: Buffer) => (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

/** Compares two answers; returns the problems (empty = same). */
export function compare(kind: string, a: Answer, b: Answer): { problems: string[]; ignored: string[] } {
  const problems: string[] = [];
  const ignored: string[] = [];
  if (a.status !== b.status) problems.push(`status ${a.status} vs ${b.status}`);
  if (a.type !== b.type) problems.push(`content-type "${a.type}" vs "${b.type}"`);
  for (const h of ['content-disposition', 'cache-control']) if ((a.headers[h] || '') !== (b.headers[h] || '')) problems.push(`${h} "${a.headers[h] || ''}" vs "${b.headers[h] || ''}"`);
  if (kind === 'pdf' && a.status === 200) {
    if (a.body.subarray(0, 4).toString() !== '%PDF' || b.body.subarray(0, 4).toString() !== '%PDF') problems.push('not a PDF');
    if (Math.abs(a.body.length - b.body.length) > a.body.length * 0.02) problems.push(`PDF size ${a.body.length} vs ${b.body.length}`);
    if (pdfPages(a.body) !== pdfPages(b.body)) problems.push(`PDF pages ${pdfPages(a.body)} vs ${pdfPages(b.body)}`);
    return { problems, ignored: ['bytes (Generated line / creation date)'] };
  }
  if (/json/.test(a.type) && /json/.test(b.type)) {
    let ja: unknown, jb: unknown;
    try { ja = JSON.parse(a.body.toString()); jb = JSON.parse(b.body.toString()); } catch { problems.push('body is not JSON'); return { problems, ignored }; }
    const rules = IGNORED[kind]?.paths || [];
    for (const d of jsonDiff(ja, jb)) (rules.some((r) => r.test(d)) ? ignored : problems).push(d);
    if (problems.length > 8) problems.splice(8, problems.length, `… ${problems.length - 8} more`);
  } else if (!a.body.equals(b.body)) {
    problems.push(`body differs (${a.body.length} vs ${b.body.length} bytes)`);
  }
  return { problems, ignored };
}

const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];

async function main(argv = process.argv.slice(2)) {
  const envFile = argValue(argv, '--env-file');
  if (!envFile) throw new Error('usage: node scripts/lambda-e2e.ts --env-file <file> [--mode full|direct] [--runs 3]');
  const handler = argValue(argv, '--handler') || 'src/lambda/handler.ts';
  const runs = Math.max(1, Number(argValue(argv, '--runs') || 3));
  const fileEnv = parseEnvFile(fs.readFileSync(path.resolve(envFile), 'utf8'));
  assertSafe(fileEnv);
  const worktreeKeys = fs.existsSync(path.join(ROOT, '.env')) ? Object.keys(parseEnvFile(fs.readFileSync(path.join(ROOT, '.env'), 'utf8'))) : [];
  if (!fs.existsSync(path.resolve(ROOT, handler))) throw new Error(`${handler} doesn't exist yet.`);
  let mode = argValue(argv, '--mode') || 'full';
  const serverText = fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');
  if (mode === 'full' && !/lambdaForward/.test(serverText)) {
    console.log('⚠ server.ts doesn\'t use src/server/lambdaForward.ts yet — running --mode direct.');
    mode = 'direct';
  }
  const forwardSecret = fileEnv.FORWARD_SECRET || `e2e-${crypto.randomBytes(8).toString('hex')}`;
  const relaySecret = fileEnv.RELAY_SECRET || `e2e-${crypto.randomBytes(8).toString('hex')}`;
  const common = { FORWARD_SECRET: forwardSecret, RELAY_SECRET: relaySecret, JOBS: 'off', NODE_ENV: fileEnv.NODE_ENV || 'development' };

  // Who to sign in as: an active staff login whose role can view and export permits.
  const mongo = new MongoClient(fileEnv.MONGO_URI);
  await mongo.connect();
  const db = mongo.db();
  const roles = await db.collection('roles').find({ permissions: { $all: [PERMITS.VIEW, PERMITS.EXPORT] } }, { projection: { name: 1 } }).toArray();
  const user = await db.collection('users').findOne({
    role: { $in: roles.map((r) => r.name) }, isActive: { $ne: false }, mustChangePassword: { $ne: true }
  }, { projection: { _id: 1, sessionVersion: 1, role: 1 } });
  const licenseRow = await db.collection('permits').findOne({ 'contacts.kind': 'contractor', 'contacts.license': { $nin: ['', null] } }, { projection: { contacts: 1 } });
  await mongo.close();
  if (!user) throw new Error('No active login in the local copy holds view_permits + export_permits.');
  const token = signStaffSession(user as { _id: unknown; sessionVersion?: number }, fileEnv.JWT_SECRET);
  const license = (licenseRow?.contacts || []).find((c: { kind?: string; license?: string }) => c.kind === 'contractor' && c.license)?.license as string | undefined;
  console.log(`Signed in as a "${user.role}" login (${String(user._id).slice(-6)}); mode ${mode}; ${runs} run(s) each.\n`);

  try {
    // 1. The emulator + handler, plain Render, and (full) forwarding Render.
    const emu = start('lambda-local', [path.join('scripts', 'lambda-local.ts'), '--handler', handler, '--port', String(EMULATOR_PORT), '--route-prefix', '/api/permits', '--function-name', 'easy-surfaces-local-api-permits'],
      childEnv(fileEnv, worktreeKeys, { ...common, RUNTIME: 'lambda', MODULE: 'permits', RELAY_URL: `http://localhost:${mode === 'full' ? FORWARD_PORT : PLAIN_PORT}/api/internal/relay`, PORT: '' }));
    const plain = start('render-plain', ['server.ts'], childEnv(fileEnv, worktreeKeys, { ...common, PORT: String(PLAIN_PORT), LAMBDA_API_URL: '', LAMBDA_ROUTES: '' }));
    await waitFor(plain, `http://127.0.0.1:${PLAIN_PORT}/api/health`);
    let fwd: Started | null = null;
    if (mode === 'full') {
      fwd = start('render-forward', ['server.ts'], childEnv(fileEnv, worktreeKeys, { ...common, PORT: String(FORWARD_PORT), LAMBDA_API_URL: `http://localhost:${EMULATOR_PORT}`, LAMBDA_ROUTES }));
      await waitFor(fwd, `http://127.0.0.1:${FORWARD_PORT}/api/health`);
    }
    await waitFor(emu, `http://127.0.0.1:${EMULATOR_PORT}/api/permits/meta`, 30_000);

    const PLAIN = `http://127.0.0.1:${PLAIN_PORT}`;
    const EMU = `http://127.0.0.1:${EMULATOR_PORT}`;
    const FWD = `http://127.0.0.1:${FORWARD_PORT}`;
    const auth = { cookie: `customerToken=${token}` };
    // What the forwarder adds (src/lambda/README.md), so the emulator can be called directly.
    const asForwarded = (extra: Record<string, string> = {}) => ({
      ...extra, 'x-forward-secret': forwardSecret, 'x-forwarded-for': '127.0.0.1', 'x-forwarded-host': `localhost:${PLAIN_PORT}`,
      'x-forwarded-proto': 'http', 'x-request-id': crypto.randomUUID()
    });

    const cases: { name: string; kind: string; path: string; headers: Record<string, string> }[] = [
      { name: 'meta', kind: 'meta', path: '/api/permits/meta', headers: auth },
      { name: 'list', kind: 'list', path: '/api/permits?limit=50', headers: auth },
      { name: 'list filtered', kind: 'list', path: '/api/permits?counties=king,snohomish&category=new_home&sort=value_desc&page=2&limit=25', headers: auth },
      { name: 'list bad filter (400)', kind: 'list', path: '/api/permits?from=yesterday', headers: auth },
      { name: 'list Bearer', kind: 'list', path: '/api/permits?limit=5&q=road', headers: { authorization: `Bearer ${token}` } },
      { name: 'no token (401)', kind: 'list', path: '/api/permits/meta', headers: {} },
      { name: 'export small', kind: 'export', path: '/api/permits/export?counties=whatcom', headers: auth },
      // The largest export the route allows (≤ 5,000 permits): close to Lambda's 6 MB answer cap?
      { name: 'export large', kind: 'export', path: '/api/permits/export?counties=pierce,clark,snohomish', headers: auth },
      { name: 'export too many (400)', kind: 'export', path: '/api/permits/export', headers: auth },
      { name: 'export.pdf', kind: 'pdf', path: '/api/permits/export.pdf?counties=whatcom&download=1', headers: auth },
      ...(license && !argv.includes('--no-contractor') ? [{ name: 'contractor', kind: 'contractor', path: `/api/permits/contractor/${encodeURIComponent(license)}`, headers: auth }] : [])
    ];

    let failed = 0;
    const timings: string[] = [];
    const sizes: string[] = [];
    // Cold start: the first call the handler gets.
    const cold = await call(EMU, '/api/permits/meta', { headers: asForwarded(auth) });
    timings.push(`cold start (first meta on the emulator): ${cold.ms} ms → ${cold.status}`);

    for (const c of cases) {
      const ms: Record<string, number[]> = { render: [], lambda: [], forwarded: [] };
      let r: Answer | null = null, l: Answer | null = null, f: Answer | null = null;
      for (let i = 0; i < runs; i++) {
        r = await call(PLAIN, c.path, { headers: c.headers }); ms.render.push(r.ms);
        l = await call(EMU, c.path, { headers: asForwarded(c.headers) }); ms.lambda.push(l.ms);
        if (fwd) { f = await call(FWD, c.path, { headers: c.headers }); ms.forwarded.push(f.ms); }
      }
      const results = [['lambda direct', compare(c.kind, r!, l!)], ...(f ? [['forwarded', compare(c.kind, r!, f)] as const] : [])] as const;
      for (const [label, { problems, ignored }] of results) {
        const ok = problems.length === 0;
        if (!ok) failed++;
        console.log(`${ok ? '✓' : '✗'} ${c.name} — ${label}: ${r!.status} ${r!.type.split(';')[0]}${ok ? '' : `\n    ${problems.join('\n    ')}`}${ignored.length ? `\n    ignored: ${ignored.slice(0, 6).join(', ')}${ignored.length > 6 ? ` +${ignored.length - 6}` : ''}` : ''}`);
      }
      timings.push(`${c.name.padEnd(22)} render ${median(ms.render)} ms · lambda ${median(ms.lambda)} ms${fwd ? ` · forwarded ${median(ms.forwarded)} ms` : ''}`);
      // Decompressed size; Lambda's cap (6 MB) applies to what its Express sends, base64-encoded (×4/3) unless text.
      const big = r!.body.length * 4 / 3 > 6 * 1024 * 1024;
      sizes.push(`${c.name.padEnd(22)} ${r!.body.length.toLocaleString('en-US')} B${r!.headers['content-encoding'] ? ` (sent ${r!.headers['content-encoding']})` : ''}${big ? '  ⚠ over 6 MB once base64-encoded if Lambda sends it uncompressed' : ''} · from Lambda ${Number(l!.headers['content-length'] || 0).toLocaleString('en-US')} B${l!.headers['content-encoding'] ? ` ${l!.headers['content-encoding']}` : ''}`);
    }

    // 2. Straight at the emulator without the secret → 403.
    const noSecret = await call(EMU, '/api/permits/meta', { headers: auth });
    const s403 = noSecret.status === 403;
    if (!s403) failed++;
    console.log(`${s403 ? '✓' : '✗'} no x-forward-secret straight at :${EMULATOR_PORT} → ${noSecret.status} (want 403)`);
    const wrong = await call(EMU, '/api/permits/meta', { headers: { ...asForwarded(auth), 'x-forward-secret': 'wrong' } });
    if (wrong.status !== 403) failed++;
    console.log(`${wrong.status === 403 ? '✓' : '✗'} wrong x-forward-secret → ${wrong.status} (want 403)`);

    // 3. (full) /refresh stays on Render: unauthenticated, so nothing starts a pull.
    if (fwd) {
      const seen = () => emu.lines.filter((l) => /\/api\/permits\/refresh/.test(l)).length;
      const before = seen();
      const ref = await call(FWD, '/api/permits/refresh', { method: 'POST' });
      await new Promise((r) => setTimeout(r, 300));
      const notForwarded = seen() === before && ref.status === 401;
      if (!notForwarded) failed++;
      console.log(`${notForwarded ? '✓' : '✗'} POST /api/permits/refresh answered by Render (${ref.status}), emulator saw it ${seen() - before}×`);
      const forwardedCount = emu.lines.filter((l) => /\[lambda-local\] GET \/api\/permits/.test(l)).length;
      console.log(`  emulator served ${forwardedCount} Permits GETs in all (direct + forwarded)`);
    }

    console.log('\nTimings (median):');
    for (const t of timings) console.log(`  ${t}`);
    console.log('\nAnswer sizes, decompressed (Lambda\'s cap is 6 MB for what it returns, base64 included):');
    for (const s of sizes) console.log(`  ${s}`);
    console.log('\nIgnored on purpose:');
    for (const [k, v] of Object.entries(IGNORED)) console.log(`  ${k}: ${v.why}`);
    const errs = started.flatMap((s) => s.lines.filter((l) => /Error|❌|Unhandled/.test(l)).slice(0, 5).map((l) => `  [${s.name}] ${l.slice(0, 200)}`));
    if (errs.length) console.log(`\nError lines in the servers' logs (first few each):\n${errs.join('\n')}`);
    console.log(`\n${failed ? `✗ ${failed} check(s) failed` : '✓ all checks passed'}`);
    return failed;
  } finally {
    await stopAll();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const bail = () => { stopAll().finally(() => process.exit(130)); };
  process.on('SIGINT', bail);
  process.on('SIGTERM', bail);
  main().then((failed) => process.exit(failed ? 1 : 0), async (err) => {
    console.error((err as Error).message || err);
    await stopAll();
    process.exit(1);
  });
}
