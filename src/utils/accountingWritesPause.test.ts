import { describe, it, expect } from 'vitest';
import { accountingWritesPaused, isAccountingWrite, accountingWritesPauseGate, ACCOUNTING_PAUSED_MESSAGE } from './accountingWritesPause.ts';

describe('Accounting write pause', () => {
  it('is off unless ACCOUNTING_WRITES_PAUSED is true', () => {
    expect(accountingWritesPaused({})).toBe(false);
    expect(accountingWritesPaused({ ACCOUNTING_WRITES_PAUSED: 'false' } as never)).toBe(false);
    expect(accountingWritesPaused({ ACCOUNTING_WRITES_PAUSED: ' TRUE ' } as never)).toBe(true);
  });

  it('pauses freight writes, not reads and not Fuel Man', () => {
    expect(isAccountingWrite('POST', '/api/accounting/freight-charges/pay')).toBe(true);
    expect(isAccountingWrite('PATCH', '/api/accounting/carriers/abc?x=1')).toBe(true);
    expect(isAccountingWrite('POST', '/api/accounting/carrier-invoices/')).toBe(true);
    expect(isAccountingWrite('GET', '/api/accounting/freight-charges')).toBe(false);
    expect(isAccountingWrite('POST', '/api/accounting/fuel-man/reports')).toBe(false);
    expect(isAccountingWrite('POST', '/api/accountingmore')).toBe(false);
    expect(isAccountingWrite('POST', '/api/holds')).toBe(false);
  });

  it('answers 503 with Retry-After while paused, and lets everything else through', () => {
    const run = (method: string, url: string) => {
      const out: { status?: number; body?: unknown; headers: Record<string, string>; next: boolean } = { headers: {}, next: false };
      const res = { set: (k: string, v: string) => { out.headers[k] = v; }, status(code: number) { out.status = code; return this; }, json(b: unknown) { out.body = b; return this; } };
      accountingWritesPauseGate({ method, originalUrl: url, url } as never, res as never, () => { out.next = true; });
      return out;
    };
    process.env.ACCOUNTING_WRITES_PAUSED = 'true';
    try {
      const blocked = run('POST', '/api/accounting/freight-charges/approve');
      expect(blocked.status).toBe(503);
      expect(blocked.headers['Retry-After']).toBe('120');
      expect(blocked.body).toEqual({ message: ACCOUNTING_PAUSED_MESSAGE, paused: true });
      expect(run('GET', '/api/accounting/carriers').next).toBe(true);
      expect(run('POST', '/api/accounting/fuel-man/reports').next).toBe(true);
    } finally { delete process.env.ACCOUNTING_WRITES_PAUSED; }
    expect(run('POST', '/api/accounting/freight-charges/approve').next).toBe(true);
  });
});
