import { describe, it, expect } from 'vitest';
import { suppliersWritesPaused, isSuppliersWrite, suppliersWritesPauseGate, SUPPLIERS_PAUSED_MESSAGE } from './suppliersWritesPause.ts';

describe('Supplier POs write pause', () => {
  it('is off unless SUPPLIERS_WRITES_PAUSED is true', () => {
    expect(suppliersWritesPaused({})).toBe(false);
    expect(suppliersWritesPaused({ SUPPLIERS_WRITES_PAUSED: 'false' } as never)).toBe(false);
    expect(suppliersWritesPaused({ SUPPLIERS_WRITES_PAUSED: ' TRUE ' } as never)).toBe(true);
  });

  it('pauses every write on both sides (sign-in too), not reads, signing out or the photo store', () => {
    expect(isSuppliersWrite('POST', '/api/suppliers/pos')).toBe(true);
    expect(isSuppliersWrite('PUT', '/api/suppliers/pos/abc?x=1')).toBe(true);
    expect(isSuppliersWrite('POST', '/api/suppliers/blocks/abc/decide')).toBe(true);
    expect(isSuppliersWrite('POST', '/api/supplier-portal/sign-in')).toBe(true);
    expect(isSuppliersWrite('PUT', '/api/supplier-portal/blocks/abc/bundles/b1')).toBe(true);
    expect(isSuppliersWrite('DELETE', '/api/supplier-portal/blocks/abc/')).toBe(true);
    expect(isSuppliersWrite('GET', '/api/suppliers/pos')).toBe(false);
    expect(isSuppliersWrite('GET', '/api/supplier-portal/pos/abc')).toBe(false);
    expect(isSuppliersWrite('POST', '/api/supplier-portal/sign-out')).toBe(false);
    expect(isSuppliersWrite('POST', '/api/suppliers/block-photos')).toBe(false);
    expect(isSuppliersWrite('POST', '/api/holds')).toBe(false);
    expect(isSuppliersWrite('POST', '/api/suppliersmore')).toBe(false);
  });

  it('answers 503 with Retry-After while paused, and lets everything else through', () => {
    const run = (method: string, url: string) => {
      const out: { status?: number; body?: unknown; headers: Record<string, string>; next: boolean } = { headers: {}, next: false };
      const res = { set: (k: string, v: string) => { out.headers[k] = v; }, status(code: number) { out.status = code; return this; }, json(b: unknown) { out.body = b; return this; } };
      suppliersWritesPauseGate({ method, originalUrl: url, url } as never, res as never, () => { out.next = true; });
      return out;
    };
    process.env.SUPPLIERS_WRITES_PAUSED = 'true';
    try {
      const blocked = run('POST', '/api/supplier-portal/blocks/abc/send');
      expect(blocked.status).toBe(503);
      expect(blocked.headers['Retry-After']).toBe('120');
      expect(blocked.body).toEqual({ message: SUPPLIERS_PAUSED_MESSAGE, paused: true });
      expect(run('GET', '/api/suppliers/pos').next).toBe(true);
    } finally { delete process.env.SUPPLIERS_WRITES_PAUSED; }
    expect(run('POST', '/api/supplier-portal/blocks/abc/send').next).toBe(true);
  });
});
