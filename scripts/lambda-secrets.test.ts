// Run with: npx vitest run --config scripts/vitest.scripts.config.ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseEnvFile, planSecret, SERVER_KEYS, DROPPED_ON_PURPOSE, DROPPED_PREFIXES, ADDED_KEYS, dropReason, main } from './lambda-secrets.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('parseEnvFile', () => {
  it('reads the dotenv shapes', () => {
    const env = parseEnvFile([
      '# comment', '', 'A=1', 'export B = two ', 'C="quoted # not a comment"', "D='single'", 'E=plain # comment',
      'F="line1\\nline2"', 'G="multi', 'line"', 'H=', 'I=a=b=c', 'not a line', 'J=`tick`', 'K="esc \\"q\\""'
    ].join('\r\n'));
    expect(env).toEqual({
      A: '1', B: 'two', C: 'quoted # not a comment', D: 'single', E: 'plain', F: 'line1\nline2', G: 'multi\nline', H: '', I: 'a=b=c', J: 'tick', K: 'esc "q"'
    });
  });

  it('reads a value with a mongo URI intact', () => {
    expect(parseEnvFile('MONGO_URI=mongodb+srv://u:p@h/db?retryWrites=true&w=majority').MONGO_URI).toBe('mongodb+srv://u:p@h/db?retryWrites=true&w=majority');
  });
});

describe('planSecret', () => {
  const base = { MONGO_URI: 'mongodb+srv://x', JWT_SECRET: 'j', FRONTEND_URL: 'https://site', SMTP_USER: 'u', SMTP_PASS: 'p' };
  const relayUrl = 'https://site.onrender.com/api/internal/relay';

  it('keeps server keys and drops the rest', () => {
    const plan = planSecret({
      ...base, PORT: '3001', NODE_ENV: 'production', RENDER_EXTERNAL_URL: 'x', VITE_GOOGLE_MAP_ID: 'm', AWS_ACCESS_KEY_ID: 'k', AWS_REGION: 'us-east-2',
      TARGET_MONGO_USER: 'u', SOMETHING_ELSE: 'z', GOOGLE_CLIENT_ID: ''
    }, { relayUrl, random: () => 'R' });
    expect(plan.kept).toEqual(['FRONTEND_URL', 'JWT_SECRET', 'MONGO_URI', 'SMTP_PASS', 'SMTP_USER']);
    expect(plan.dropped).toEqual(['AWS_ACCESS_KEY_ID', 'AWS_REGION', 'GOOGLE_CLIENT_ID', 'NODE_ENV', 'PORT', 'RENDER_EXTERNAL_URL', 'SOMETHING_ELSE', 'TARGET_MONGO_USER', 'VITE_GOOGLE_MAP_ID']);
    expect(plan.secret).toEqual({ ...base, FORWARD_SECRET: 'R', RELAY_SECRET: 'R', RELAY_URL: relayUrl });
    expect(plan.generated).toEqual(['FORWARD_SECRET', 'RELAY_SECRET']);
    expect(plan.warnings).toEqual([]);
    expect(dropReason('RENDER_GIT_COMMIT')).toMatch(/RENDER_/);
    expect(dropReason('SOMETHING_ELSE')).toMatch(/--keep/);
  });

  it('keeps FORWARD_SECRET / RELAY_SECRET from the file, ignores a RELAY_URL there', () => {
    const plan = planSecret({ ...base, FORWARD_SECRET: 'f', RELAY_SECRET: 'r', RELAY_URL: 'http://old' }, { relayUrl, random: () => 'NEW' });
    expect(plan.generated).toEqual([]);
    expect(plan.secret).toMatchObject({ FORWARD_SECRET: 'f', RELAY_SECRET: 'r', RELAY_URL: relayUrl });
  });

  it('--keep sends an extra key', () => {
    expect(planSecret({ ...base, EXTRA: '1' }, { relayUrl, keep: ['EXTRA'] }).kept).toContain('EXTRA');
  });

  it('refuses or warns on bad input', () => {
    expect(() => planSecret(base, { relayUrl: '' })).toThrow(/relay-url/);
    expect(() => planSecret(base, { relayUrl: 'nope' })).toThrow(/not a URL/);
    expect(() => planSecret({ JWT_SECRET: 'j' }, { relayUrl })).toThrow(/MONGO_URI/);
    const w = planSecret({ MONGO_URI: 'mongodb://127.0.0.1:27027', JWT_SECRET: 'j' }, { relayUrl: 'http://example.com/x' }).warnings;
    expect(w.join(' ')).toMatch(/not https/);
    expect(w.join(' ')).toMatch(/internal\/relay/);
    expect(w.join(' ')).toMatch(/FRONTEND_URL/);
    expect(w.join(' ')).toMatch(/this machine/);
  });

  it('dry run lists names only, never values, and calls nothing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-secrets-test-'));
    const file = path.join(dir, 'env');
    fs.writeFileSync(file, 'MONGO_URI=mongodb+srv://SECRETVALUE@h/db\nJWT_SECRET=SECRETVALUE2\nPORT=1\n');
    const lines: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => { lines.push(a.join(' ')); };
    try {
      await main(['--from', file, '--relay-url', relayUrl, '--dry-run']);
    } finally {
      console.log = log;
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const out = lines.join('\n');
    expect(out).toMatch(/DRY RUN/);
    expect(out).toMatch(/MONGO_URI/);
    expect(out).not.toMatch(/SECRETVALUE/);
  });
});

/** Every process.env key the server code reads (server.ts + src, not tests or the browser code). */
function serverEnvKeys() {
  const files: string[] = [path.join(ROOT, 'server.ts')];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|js)$/.test(e.name) && !/\.test\.|\.d\.ts$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  const keys = new Set<string>();
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/process\.env(?:\.([A-Z_][A-Z0-9_]*)|\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\])/g)) keys.add(m[1] || m[2]);
    for (const m of text.matchAll(/const\s*\{([^}]+)\}\s*=\s*process\.env/g)) {
      for (const k of m[1].split(',')) { const name = k.split(':')[0].split('=')[0].trim(); if (/^[A-Z_][A-Z0-9_]*$/.test(name)) keys.add(name); }
    }
  }
  return [...keys].sort();
}

describe('SERVER_KEYS against the code', () => {
  it('every env key the server reads is kept or dropped on purpose', () => {
    const known = new Set<string>([...SERVER_KEYS, ...Object.keys(DROPPED_ON_PURPOSE), ...ADDED_KEYS]);
    const unknown = serverEnvKeys().filter((k) => !known.has(k) && !DROPPED_PREFIXES.some((p) => k.startsWith(p)));
    // A new key: add it to SERVER_KEYS (Lambda needs it) or DROPPED_ON_PURPOSE (with why).
    expect(unknown).toEqual([]);
  });
});

describe('putSecretValue', () => {
  it('signs a PutSecretValue request (fake fetch, fake keys — no AWS)', async () => {
    const { putSecretValue } = await import('./lambda-secrets.ts');
    let seen: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ ARN: 'arn:x', VersionId: 'v1' }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await putSecretValue('easy-surfaces/dev/app', '{"A":"1"}', { credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'x' }, fetchImpl: fakeFetch });
    expect(out.VersionId).toBe('v1');
    const s = seen as unknown as { url: string; init: RequestInit };
    expect(s.url).toBe('https://secretsmanager.us-east-2.amazonaws.com/');
    const h = s.init.headers as Record<string, string>;
    expect(h['x-amz-target']).toBe('secretsmanager.PutSecretValue');
    expect(h.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-2\/secretsmanager\/aws4_request, SignedHeaders=.*host.*x-amz-target.*, Signature=[0-9a-f]{64}$/);
    expect(h.host).toBeUndefined();
    expect(JSON.parse(String(s.init.body))).toMatchObject({ SecretId: 'easy-surfaces/dev/app', SecretString: '{"A":"1"}' });
  });
});
