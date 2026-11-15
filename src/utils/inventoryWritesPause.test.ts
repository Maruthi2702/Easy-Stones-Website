import { describe, it, expect } from 'vitest';
import { isInventoryWrite, inventoryWritesPaused } from './inventoryWritesPause.ts';

describe('inventory pause', () => {
  it('is on only for the word true', () => {
    expect(inventoryWritesPaused({ INVENTORY_WRITES_PAUSED: ' TRUE ' } as never)).toBe(true);
    expect(inventoryWritesPaused({} as never)).toBe(false);
    expect(inventoryWritesPaused({ INVENTORY_WRITES_PAUSED: '1' } as never)).toBe(false);
  });
  it('stops stock, sales, in-transit and purchasing writes, never reads or other areas', () => {
    expect(isInventoryWrite('POST', '/api/inventory-analysis/import/stock/apply')).toBe(true);
    expect(isInventoryWrite('POST', '/api/inventory-analysis/import/sales/apply?x=1')).toBe(true);
    expect(isInventoryWrite('POST', '/api/purchasing/drafts')).toBe(true);
    expect(isInventoryWrite('PATCH', '/api/purchasing/scopes/abc')).toBe(true);
    expect(isInventoryWrite('GET', '/api/inventory-analysis/summary')).toBe(false);
    expect(isInventoryWrite('GET', '/api/purchasing/scopes')).toBe(false);
    expect(isInventoryWrite('POST', '/api/holds')).toBe(false);
    expect(isInventoryWrite('POST', '/api/customers')).toBe(false);
  });
});
