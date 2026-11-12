import { describe, it, expect } from 'vitest';
import { isCustomerWrite, customerWritesPaused, customerWritesPauseGate, PAUSED_MESSAGE } from './customerWritesPause.ts';

describe('customer writes pause', () => {
  it('is off unless CUSTOMER_WRITES_PAUSED is exactly true', () => {
    expect(customerWritesPaused({})).toBe(false);
    expect(customerWritesPaused({ CUSTOMER_WRITES_PAUSED: 'false' })).toBe(false);
    expect(customerWritesPaused({ CUSTOMER_WRITES_PAUSED: ' True ' })).toBe(true);
  });

  it('holds back every customer-area write, old addresses and calendar syncs included', () => {
    const writes: [string, string][] = [
      ['POST', '/api/customers'], ['PUT', '/api/customers/6a5/visits/6a6'], ['PATCH', '/api/customers/6a5/visits/6a6/follow-up'],
      ['DELETE', '/api/customers/6a5/resources/6a7'], ['POST', '/api/customers/bulk-delete'], ['PATCH', '/api/customers/bulk'],
      ['POST', '/api/customers/import/apply'], ['POST', '/api/customers/sps-import/abc/start'], ['POST', '/api/partners'],
      ['POST', '/api/sales/customers'], ['PUT', '/api/admin/customers/6a5'], ['POST', '/api/schedule'], ['DELETE', '/api/schedule/6a8'],
      ['POST', '/api/schedule/bulk'], ['POST', '/api/customer/register'], ['POST', '/api/customer/login'],
      ['POST', '/api/auth/google/calendar/sync'], ['POST', '/api/auth/icloud/sync'], ['POST', '/api/customers/list?x=1']
    ];
    for (const [m, p] of writes) expect(isCustomerWrite(m, p), `${m} ${p}`).toBe(true);
  });

  it('lets reads and every other area through', () => {
    const open: [string, string][] = [
      ['GET', '/api/customers/list'], ['GET', '/api/schedule'], ['HEAD', '/api/customers'], ['OPTIONS', '/api/customers'],
      ['POST', '/api/auth/login'], ['POST', '/api/deliveries'], ['POST', '/api/checkin'], ['PUT', '/api/daily-reports/2026-11-12'],
      ['POST', '/api/payments-received'], ['POST', '/api/customer/logout'], ['POST', '/api/customersomething'], ['GET', '/api/customer/me']
    ];
    for (const [m, p] of open) expect(isCustomerWrite(m, p), `${m} ${p}`).toBe(false);
  });

  it('answers 503 with a plain message while paused, and passes everything on otherwise', () => {
    const calls: unknown[] = [];
    const res = { set: (...a: unknown[]) => { calls.push(['set', ...a]); return res; }, status: (c: number) => { calls.push(['status', c]); return res; }, json: (b: unknown) => { calls.push(['json', b]); return res; } };
    let next = 0;
    process.env.CUSTOMER_WRITES_PAUSED = 'true';
    try {
      customerWritesPauseGate({ method: 'POST', originalUrl: '/api/customers', url: '/' } as never, res as never, () => { next++; });
      expect(next).toBe(0);
      expect(calls).toContainEqual(['status', 503]);
      expect(calls).toContainEqual(['json', { message: PAUSED_MESSAGE, paused: true }]);
      customerWritesPauseGate({ method: 'GET', originalUrl: '/api/customers/list', url: '/' } as never, res as never, () => { next++; });
      expect(next).toBe(1);
    } finally {
      delete process.env.CUSTOMER_WRITES_PAUSED;
    }
    customerWritesPauseGate({ method: 'POST', originalUrl: '/api/customers', url: '/' } as never, res as never, () => { next++; });
    expect(next).toBe(2);
  });
});
