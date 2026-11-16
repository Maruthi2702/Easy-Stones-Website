import { describe, it, expect } from 'vitest';
import { isTypesWrite, typesWritesPaused } from './typesWritesPause.ts';

describe('type lists pause', () => {
  it('is on only for the word true', () => {
    expect(typesWritesPaused({ TYPES_WRITES_PAUSED: ' True ' } as never)).toBe(true);
    expect(typesWritesPaused({} as never)).toBe(false);
  });
  it('stops every save on the three lists, never reads or other areas', () => {
    for (const [m, p] of [['POST', '/api/visit-types'], ['PUT', '/api/resource-types/abc'], ['PATCH', '/api/resource-families/reorder'], ['DELETE', '/api/visit-types/abc?x=1']] as const) expect(isTypesWrite(m, p), `${m} ${p}`).toBe(true);
    for (const [m, p] of [['GET', '/api/visit-types'], ['GET', '/api/resource-types/abc/uses'], ['POST', '/api/customers']] as const) expect(isTypesWrite(m, p), `${m} ${p}`).toBe(false);
  });
});
