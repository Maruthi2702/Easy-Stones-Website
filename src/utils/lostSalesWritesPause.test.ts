import { describe, it, expect } from 'vitest';
import { isLostSaleWrite, lostSalesWritesPaused } from './lostSalesWritesPause.ts';

describe('lost sales pause', () => {
  it('is on only for the word true', () => {
    expect(lostSalesWritesPaused({ LOST_SALES_WRITES_PAUSED: ' TRUE ' } as never)).toBe(true);
    expect(lostSalesWritesPaused({} as never)).toBe(false);
    expect(lostSalesWritesPaused({ LOST_SALES_WRITES_PAUSED: '1' } as never)).toBe(false);
  });
  it('stops lost-sale writes, never reads or other areas', () => {
    expect(isLostSaleWrite('POST', '/api/lost-sales')).toBe(true);
    expect(isLostSaleWrite('PUT', '/api/lost-sales/abc?x=1')).toBe(true);
    expect(isLostSaleWrite('DELETE', '/api/lost-sales/abc')).toBe(true);
    expect(isLostSaleWrite('GET', '/api/lost-sales')).toBe(false);
    expect(isLostSaleWrite('POST', '/api/customers')).toBe(false);
  });
});
