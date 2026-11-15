import { describe, it, expect } from 'vitest';
import { fuelmanWritesPaused, isFuelmanWrite, fuelmanWritesPauseGate, FUELMAN_PAUSED_MESSAGE } from './fuelmanWritesPause.ts';

describe('Fuel Man write pause', () => {
  it('is off unless FUELMAN_WRITES_PAUSED is true', () => {
    expect(fuelmanWritesPaused({})).toBe(false);
    expect(fuelmanWritesPaused({ FUELMAN_WRITES_PAUSED: 'false' } as never)).toBe(false);
    expect(fuelmanWritesPaused({ FUELMAN_WRITES_PAUSED: ' TRUE ' } as never)).toBe(true);
  });

  it('pauses Fuel Man writes, not reads and not other areas', () => {
    expect(isFuelmanWrite('POST', '/api/accounting/fuel-man/reports')).toBe(true);
    expect(isFuelmanWrite('POST', '/api/accounting/fuel-man/reports/abc/publish?x=1')).toBe(true);
    expect(isFuelmanWrite('POST', '/api/accounting/fuel-man/reports/abc/assignments/batch/')).toBe(true);
    expect(isFuelmanWrite('GET', '/api/accounting/fuel-man/reports')).toBe(false);
    expect(isFuelmanWrite('GET', '/api/accounting/fuel-man/reports/abc/source')).toBe(false);
    expect(isFuelmanWrite('POST', '/api/accounting/freight/approve')).toBe(false);
    expect(isFuelmanWrite('POST', '/api/accounting/fuel-manual')).toBe(false);
  });

  it('answers 503 with Retry-After while paused, and lets everything else through', () => {
    const run = (method: string, url: string) => {
      const out: { status?: number; body?: unknown; headers: Record<string, string>; next: boolean } = { headers: {}, next: false };
      const res = { set: (k: string, v: string) => { out.headers[k] = v; }, status(code: number) { out.status = code; return this; }, json(b: unknown) { out.body = b; return this; } };
      fuelmanWritesPauseGate({ method, originalUrl: url, url } as never, res as never, () => { out.next = true; });
      return out;
    };
    process.env.FUELMAN_WRITES_PAUSED = 'true';
    try {
      const blocked = run('POST', '/api/accounting/fuel-man/reports');
      expect(blocked.status).toBe(503);
      expect(blocked.headers['Retry-After']).toBe('120');
      expect(blocked.body).toEqual({ message: FUELMAN_PAUSED_MESSAGE, paused: true });
      expect(run('GET', '/api/accounting/fuel-man/reports').next).toBe(true);
    } finally { delete process.env.FUELMAN_WRITES_PAUSED; }
    expect(run('POST', '/api/accounting/fuel-man/reports').next).toBe(true);
  });
});
