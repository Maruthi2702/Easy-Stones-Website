import fs from 'node:fs';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RUNTIME_FILES } from './lambda-deploy.ts';

describe('Lambda Postgres TLS assets', () => {
  it('ships the RDS trust bundle at the path the bundled connection code reads', () => {
    const ca = 'src/db/rds-ca/global-bundle.pem';
    expect(RUNTIME_FILES).toContain(ca);
    const pem = fs.readFileSync(path.resolve(import.meta.dirname, '..', ca), 'utf8');
    const certs = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)!;
    expect(certs.length).toBeGreaterThan(0);
    expect(certs.every(cert => new X509Certificate(cert).ca)).toBe(true);
  });
});
