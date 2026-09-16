import { describe, it, expect } from 'vitest';
import {
  DELIVERY_TYPES,
  isWillCall,
  isReturn,
  isCounterReturn,
  isPendingDelivery,
  columnIdFor,
  defaultStatusFor,
  WILL_CALL_COLUMN_ID
} from './deliveryTypes.js';

const ticket = (over = {}) => ({ deliveryType: 'jobsite', truckId: 'trk_1', date: '2026-09-18', ...over });

describe('DELIVERY_TYPES', () => {
  it('matches the Delivery model enum and the server whitelist', () => {
    expect(DELIVERY_TYPES).toEqual(['jobsite', 'transfer', 'will_call', 'return']);
  });
});

describe('type predicates', () => {
  it('recognises will calls and returns', () => {
    expect(isWillCall(ticket({ deliveryType: 'will_call', truckId: '' }))).toBe(true);
    expect(isReturn(ticket({ deliveryType: 'return' }))).toBe(true);
    expect(isWillCall(ticket())).toBe(false);
    expect(isReturn(ticket())).toBe(false);
  });

  it('survives a missing delivery', () => {
    expect(isWillCall(null)).toBe(false);
    expect(isReturn(undefined)).toBe(false);
    expect(isCounterReturn(null)).toBe(false);
  });
});

describe('isCounterReturn', () => {
  it('is a return with a date and no driver', () => {
    expect(isCounterReturn(ticket({ deliveryType: 'return', truckId: '' }))).toBe(true);
  });

  it('is not a return a driver is collecting', () => {
    expect(isCounterReturn(ticket({ deliveryType: 'return', truckId: 'trk_1' }))).toBe(false);
  });

  it('is not a return with no date yet — that one is still Pending', () => {
    expect(isCounterReturn(ticket({ deliveryType: 'return', truckId: '', date: '' }))).toBe(false);
  });

  it('is not a jobsite with no driver', () => {
    expect(isCounterReturn(ticket({ truckId: '' }))).toBe(false);
  });
});

describe('isPendingDelivery', () => {
  it('is pending when a jobsite has no driver', () => {
    expect(isPendingDelivery(ticket({ truckId: '' }))).toBe(true);
  });

  it('is not pending once a driver is assigned', () => {
    expect(isPendingDelivery(ticket())).toBe(false);
  });

  it('never puts a will call in Pending — the customer collects it', () => {
    expect(isPendingDelivery(ticket({ deliveryType: 'will_call', truckId: '' }))).toBe(false);
  });

  it('never puts a dated customer drop-off in Pending — it has a day of its own', () => {
    expect(isPendingDelivery(ticket({ deliveryType: 'return', truckId: '' }))).toBe(false);
  });

  it('keeps a dateless return in Pending, so it cannot go invisible', () => {
    expect(isPendingDelivery(ticket({ deliveryType: 'return', truckId: '', date: '' }))).toBe(true);
  });

  it('treats a missing delivery as pending rather than throwing', () => {
    expect(isPendingDelivery(null)).toBe(true);
  });
});

describe('columnIdFor', () => {
  it('puts a driver-collected return in that driver’s column, not Will Call', () => {
    expect(columnIdFor(ticket({ deliveryType: 'return', truckId: 'trk_7' }))).toBe('trk_7');
  });

  it('shares the Will Call column with a customer drop-off — both move without a driver', () => {
    expect(columnIdFor(ticket({ deliveryType: 'return', truckId: '' }))).toBe(WILL_CALL_COLUMN_ID);
  });

  it('puts a will call in the Will Call column even if a truckId lingers on the record', () => {
    expect(columnIdFor(ticket({ deliveryType: 'will_call', truckId: 'trk_1' }))).toBe(WILL_CALL_COLUMN_ID);
  });

  it('falls back to the truck for everything else', () => {
    expect(columnIdFor(ticket())).toBe('trk_1');
    expect(columnIdFor(ticket({ truckId: '' }))).toBe('');
  });
});

describe('board and Pending are complements', () => {
  // Every ticket must land in exactly one of the two views. This is the rule
  // the server's two queries have to agree with; when they don't, a ticket
  // disappears from the app entirely.
  const cases = [
    ticket(),
    ticket({ truckId: '' }),
    ticket({ deliveryType: 'will_call', truckId: '' }),
    ticket({ deliveryType: 'return', truckId: 'trk_2' }),
    ticket({ deliveryType: 'return', truckId: '' }),
    ticket({ deliveryType: 'return', truckId: '', date: '' }),
    ticket({ deliveryType: 'transfer', truckId: 'trk_3' }),
    ticket({ deliveryType: 'transfer', truckId: '' })
  ];

  it.each(cases)('places %o in exactly one view', (d) => {
    const pending = isPendingDelivery(d);
    // A ticket is on the board when it has a column and a date to draw it on.
    const onBoard = Boolean(columnIdFor(d)) && Boolean(d.date);
    expect(pending || onBoard).toBe(true);
    expect(pending && onBoard).toBe(false);
  });
});

describe('defaultStatusFor', () => {
  it('is scheduled once a driver is assigned', () => {
    expect(defaultStatusFor(ticket({ status: 'pending' }))).toBe('scheduled');
  });

  it('is pending while nobody is driving it', () => {
    expect(defaultStatusFor(ticket({ truckId: '', status: 'pending' }))).toBe('pending');
  });

  it('calls a will call scheduled — no driver, but a date the customer agreed', () => {
    expect(defaultStatusFor(ticket({ deliveryType: 'will_call', truckId: '' }))).toBe('scheduled');
  });

  it('calls a dated customer drop-off scheduled for the same reason', () => {
    expect(defaultStatusFor(ticket({ deliveryType: 'return', truckId: '' }))).toBe('scheduled');
  });

  it('leaves a dateless return pending', () => {
    expect(defaultStatusFor(ticket({ deliveryType: 'return', truckId: '', date: '' }))).toBe('pending');
  });

  it('never rewrites what happened on the day', () => {
    expect(defaultStatusFor(ticket({ truckId: '', status: 'completed' }))).toBe('completed');
    expect(defaultStatusFor(ticket({ status: 'delayed' }))).toBe('delayed');
    expect(defaultStatusFor(ticket({ truckId: '', status: 'delayed' }))).toBe('delayed');
  });
});
