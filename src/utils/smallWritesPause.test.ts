import { describe, it, expect } from 'vitest';
import { isSmallWrite, smallWritesPaused } from './smallWritesPause.ts';

describe('small ones pause', () => {
  it('is on only for the word true', () => {
    expect(smallWritesPaused({ SMALL_WRITES_PAUSED: ' TRUE ' } as never)).toBe(true);
    expect(smallWritesPaused({} as never)).toBe(false);
    expect(smallWritesPaused({ SMALL_WRITES_PAUSED: '1' } as never)).toBe(false);
  });
  it('stops their writes, never reads or other areas', () => {
    for (const [m, p] of [['POST', '/api/contact'], ['POST', '/api/products/save'], ['POST', '/api/crossover-sheet'],
      ['PUT', '/api/crossover-sheet/a/b'], ['DELETE', '/api/easy-stones-colors/x'], ['PATCH', '/api/team-files/x?y=1'],
      ['POST', '/api/team-files/folders'], ['DELETE', '/api/sales-dashboard/resources/x'], ['POST', '/api/sales-resources']]) {
      expect(isSmallWrite(m, p), `${m} ${p}`).toBe(true);
    }
    for (const [m, p] of [['GET', '/api/team-files'], ['GET', '/api/products'], ['GET', '/api/crossover-sheet'],
      ['POST', '/api/customers'], ['POST', '/api/contacts-other']]) {
      expect(isSmallWrite(m, p), `${m} ${p}`).toBe(false);
    }
  });
});
