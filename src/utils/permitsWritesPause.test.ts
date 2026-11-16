import { describe, it, expect } from 'vitest';
import { isPermitsWrite, permitsWritesPaused, openPermitRuns } from './permitsWritesPause.ts';

describe('permits pause', () => {
  it('is on only for the word true', () => {
    expect(permitsWritesPaused({ PERMITS_WRITES_PAUSED: ' TRUE ' } as never)).toBe(true);
    expect(permitsWritesPaused({} as never)).toBe(false);
    expect(permitsWritesPaused({ PERMITS_WRITES_PAUSED: '1' } as never)).toBe(false);
  });
  it('stops writes under /api/permits, never reads or other areas', () => {
    for (const [m, p] of [['POST', '/api/permits/refresh'], ['POST', '/api/permits/export?x=1'], ['PUT', '/api/permits/x'], ['DELETE', '/api/permits/x/']]) {
      expect(isPermitsWrite(m, p), `${m} ${p}`).toBe(true);
    }
    for (const [m, p] of [['GET', '/api/permits'], ['GET', '/api/permits/contractor/1'], ['POST', '/api/permitsx'], ['POST', '/api/customers']]) {
      expect(isPermitsWrite(m, p), `${m} ${p}`).toBe(false);
    }
  });
  it('names runs with no finish', () => {
    expect(openPermitRuns([{ _id: 'a', source: 'king', finishedAt: new Date() }, { _id: 'b', source: 'pierce', finishedAt: null }, { _id: 'c' }]))
      .toEqual(['pierce (b)', '? (c)']);
  });
});
