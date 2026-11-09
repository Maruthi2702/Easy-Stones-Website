import { createSecureContext } from 'node:tls';
import { describe, expect, it } from 'vitest';
import { iamPoolConfig, iamTargetFrom, rdsCa } from './rdsConnection.ts';

const HOST = 'easy-surfaces-dev-db.abc123xyz.us-east-2.rds.amazonaws.com';

describe('iamTargetFrom', () => {
  it('reads an auth=iam URL, region from the host name', () => {
    expect(iamTargetFrom(`postgres://app_iam@${HOST}:5432/app?auth=iam`)).toEqual({
      host: HOST,
      port: 5432,
      user: 'app_iam',
      database: 'app',
      region: 'us-east-2',
    });
  });

  it('defaults the port and falls back to AWS_REGION for a host without one', () => {
    expect(iamTargetFrom('postgresql://app_iam@db.internal/app?auth=iam', 'us-east-2')).toMatchObject({ port: 5432, region: 'us-east-2' });
  });

  it('leaves every other URL to pg', () => {
    expect(iamTargetFrom('postgres://me:secret@localhost:5432/easystones')).toBeNull();
    expect(iamTargetFrom(`postgres://app_iam@${HOST}:5432/app?sslmode=require`)).toBeNull();
    expect(iamTargetFrom('pglite:memory')).toBeNull();
  });

  it('refuses a half-written IAM URL instead of guessing', () => {
    expect(() => iamTargetFrom(`postgres://app_iam:pw@${HOST}/app?auth=iam`)).toThrow(/must not hold a password/);
    expect(() => iamTargetFrom(`postgres://${HOST}/app?auth=iam`)).toThrow(/needs the user/);
    expect(() => iamTargetFrom(`postgres://app_iam@${HOST}/?auth=iam`)).toThrow(/needs the database name/);
    expect(() => iamTargetFrom('postgres://app_iam@db.internal/app?auth=iam')).toThrow(/no region/);
    expect(() => iamTargetFrom(`mysql://app_iam@${HOST}/app?auth=iam`)).toThrow(/must be postgres/);
  });
});

describe('TLS and tokens', () => {
  it('ships Amazon RDS certificates, including us-east-2, that Node can load', () => {
    const ca = rdsCa();
    expect(ca.match(/BEGIN CERTIFICATE/g)!.length).toBeGreaterThan(50);
    expect(() => createSecureContext({ ca })).not.toThrow();
  });

  it('verifies the server and signs a token per connection, never a fixed password', async () => {
    const before = { ...process.env };
    Object.assign(process.env, { AWS_ACCESS_KEY_ID: 'AKIATESTTESTTESTTEST', AWS_SECRET_ACCESS_KEY: 'test-secret' });
    try {
      const config = await iamPoolConfig(iamTargetFrom(`postgres://app_iam@${HOST}:5432/app?auth=iam`)!);
      expect(config.ssl.rejectUnauthorized).toBe(true);
      expect(config.ssl.ca).toBe(rdsCa());
      expect(typeof config.password).toBe('function');
      const token = await config.password();
      // A presigned rds-db:connect request for this host and user, signed locally.
      expect(token).toMatch(new RegExp(`^${HOST.replace(/\./g, '\\.')}:5432/\\?Action=connect&DBUser=app_iam&`));
      expect(token).toContain('X-Amz-Credential=AKIATESTTESTTESTTEST%2F');
      expect(token).toContain('%2Fus-east-2%2Frds-db%2Faws4_request');
    } finally {
      process.env = before;
    }
  });
});
