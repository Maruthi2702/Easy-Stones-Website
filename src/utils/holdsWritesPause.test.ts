import { describe, it, expect } from 'vitest';
import { holdsWritesPaused, isHoldsWrite, holdsWritesPauseGate, HOLDS_PAUSED_MESSAGE } from './holdsWritesPause.ts';

describe('Cart & Holds write pause', () => {
  it('is off unless HOLDS_WRITES_PAUSED is true', () => {
    expect(holdsWritesPaused({})).toBe(false);
    expect(holdsWritesPaused({ HOLDS_WRITES_PAUSED: 'false' } as never)).toBe(false);
    expect(holdsWritesPaused({ HOLDS_WRITES_PAUSED: ' TRUE ' } as never)).toBe(true);
  });

  it('pauses carts and holds writes, not reads and not the slab lookup', () => {
    expect(isHoldsWrite('POST', '/api/holds')).toBe(true);
    expect(isHoldsWrite('POST', '/api/holds/cart/slabs')).toBe(true);
    expect(isHoldsWrite('PATCH', '/api/holds/abc/details?x=1')).toBe(true);
    expect(isHoldsWrite('DELETE', '/api/holds/cart/')).toBe(true);
    expect(isHoldsWrite('GET', '/api/holds')).toBe(false);
    expect(isHoldsWrite('GET', '/api/holds/abc/pdf')).toBe(false);
    expect(isHoldsWrite('POST', '/api/holds/slabs/status')).toBe(false);
    expect(isHoldsWrite('POST', '/api/inventory-analysis/import')).toBe(false);
    expect(isHoldsWrite('POST', '/api/holdsmore')).toBe(false);
  });

  it('answers 503 with Retry-After while paused, and lets everything else through', () => {
    const run = (method: string, url: string) => {
      const out: { status?: number; body?: unknown; headers: Record<string, string>; next: boolean } = { headers: {}, next: false };
      const res = { set: (k: string, v: string) => { out.headers[k] = v; }, status(code: number) { out.status = code; return this; }, json(b: unknown) { out.body = b; return this; } };
      holdsWritesPauseGate({ method, originalUrl: url, url } as never, res as never, () => { out.next = true; });
      return out;
    };
    process.env.HOLDS_WRITES_PAUSED = 'true';
    try {
      const blocked = run('POST', '/api/holds/cart/slabs');
      expect(blocked.status).toBe(503);
      expect(blocked.headers['Retry-After']).toBe('120');
      expect(blocked.body).toEqual({ message: HOLDS_PAUSED_MESSAGE, paused: true });
      expect(run('GET', '/api/holds').next).toBe(true);
    } finally { delete process.env.HOLDS_WRITES_PAUSED; }
    expect(run('POST', '/api/holds/cart/slabs').next).toBe(true);
  });
});
