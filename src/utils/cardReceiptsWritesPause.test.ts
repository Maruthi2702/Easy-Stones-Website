import { describe, it, expect } from 'vitest';
import { isCardReceiptWrite, cardReceiptsWritesPaused } from './cardReceiptsWritesPause.ts';

describe('card receipts pause', () => {
  it('is on only for the word true', () => {
    expect(cardReceiptsWritesPaused({ CARD_RECEIPTS_WRITES_PAUSED: 'true' } as never)).toBe(true);
    expect(cardReceiptsWritesPaused({ CARD_RECEIPTS_WRITES_PAUSED: ' TRUE ' } as never)).toBe(true);
    expect(cardReceiptsWritesPaused({} as never)).toBe(false);
    expect(cardReceiptsWritesPaused({ CARD_RECEIPTS_WRITES_PAUSED: '1' } as never)).toBe(false);
  });
  it('stops every write under /api/card-receipts, never reads or other areas', () => {
    expect(isCardReceiptWrite('POST', '/api/card-receipts/expenses')).toBe(true);
    expect(isCardReceiptWrite('PUT', '/api/card-receipts/expenses/abc')).toBe(true);
    expect(isCardReceiptWrite('POST', '/api/card-receipts/expenses/abc/approve')).toBe(true);
    expect(isCardReceiptWrite('PATCH', '/api/card-receipts/categories/reorder')).toBe(true);
    expect(isCardReceiptWrite('DELETE', '/api/card-receipts/categories/abc')).toBe(true);
    expect(isCardReceiptWrite('POST', '/api/card-receipts/attachments')).toBe(true);
    expect(isCardReceiptWrite('GET', '/api/card-receipts/expenses?month=2026-11')).toBe(false);
    expect(isCardReceiptWrite('POST', '/api/payments-received')).toBe(false);
  });
});
