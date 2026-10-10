import { describe, it, expect } from 'vitest';
import {
  FREIGHT_TABS, tabCount, groupByCarrier, selectionActions, referenceLabel, paymentMethodText,
  historyLabel, todayIso, shortDate, newRequestId, freightExportRows
} from './freightView.js';
import { FREIGHT } from '../accounting/permissions.js';

const ABC = { _id: 'c1', name: 'ABC Freight Inc', paymentTerms: 'per_delivery' };
const WX = { _id: 'c2', name: 'Western Express', paymentTerms: 'per_invoice' };
const charge = (over = {}) => ({ _id: Math.random().toString(36), status: 'draft', amountCents: 45000, carrier: ABC, carrierId: 'c1', flags: [], ...over });
const user = (...perms) => ({ permissions: [FREIGHT.VIEW, ...perms] });

describe('tabs', () => {
  it('are To approve, Approved, Paid, All — counted from the summary', () => {
    expect(FREIGHT_TABS.map((t) => t.id)).toEqual(['to_approve', 'approved', 'paid', 'all']);
    const summary = { draft: { count: 7 }, approved: { count: 5 }, paid: { count: 16 }, void: { count: 1 }, toApprove: 9 };
    expect(tabCount('to_approve', summary)).toBe(9);
    expect(tabCount('approved', summary)).toBe(5);
    expect(tabCount('paid', summary)).toBe(16);
    expect(tabCount('all', summary)).toBe(29);
    expect(tabCount('all', undefined)).toBe(0);
  });
});

describe('groupByCarrier', () => {
  it('groups in first-seen order, totals each, and keeps an unmatched carrier as typed', () => {
    const groups = groupByCarrier([
      charge({ amountCents: 45000 }),
      charge({ carrier: WX, carrierId: 'c2', amountCents: 41000 }),
      charge({ amountCents: null }),
      charge({ carrier: null, carrierId: null, carrierNameRaw: 'Pac Haul' })
    ]);
    expect(groups.map((g) => g.name)).toEqual(['ABC Freight Inc', 'Western Express', '“Pac Haul”']);
    expect(groups[0]).toMatchObject({ cents: 45000, perInvoice: false });
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].perInvoice).toBe(true);
    expect(groups[2].unmatched).toBe(true);
  });
});

describe('selectionActions', () => {
  it('approve + pay: drafts offer Approve and Approve & pay', () => {
    const a = selectionActions([charge(), charge({ amountCents: 38000 })], user(FREIGHT.APPROVE, FREIGHT.PAY));
    expect(a).toMatchObject({ count: 2, cents: 83000, approve: true, pay: 'Approve & pay', sendBack: false });
  });

  it('pay only: approved charges can be paid; drafts say why not', () => {
    expect(selectionActions([charge({ status: 'approved' })], user(FREIGHT.PAY)).pay).toBe('Mark paid');
    const drafts = selectionActions([charge()], user(FREIGHT.PAY));
    expect(drafts.pay).toBeNull();
    expect(drafts.payBlocked).toMatch(/Approve them first/);
    expect(drafts.approve).toBe(false);
  });

  it('a flag, a missing price, two carriers or a per-invoice carrier block paying, with the reason', () => {
    const both = user(FREIGHT.APPROVE, FREIGHT.PAY);
    expect(selectionActions([charge({ openFlags: [{ detail: 'The delivery was deleted' }] })], both)).toMatchObject({ approve: false, pay: null, payBlocked: expect.stringMatching(/flagged/) });
    expect(selectionActions([charge({ amountCents: null })], both).payBlocked).toMatch(/price/);
    expect(selectionActions([charge(), charge({ carrier: { ...ABC, _id: 'c9' }, carrierId: 'c9' })], both).payBlocked).toMatch(/one carrier/);
    expect(selectionActions([charge({ carrier: WX, carrierId: 'c2' })], both)).toMatchObject({ approve: false, pay: null, payBlocked: expect.stringMatching(/invoice/) });
  });

  it('approved charges can be sent back; paid ones offer nothing', () => {
    expect(selectionActions([charge({ status: 'approved' })], user(FREIGHT.APPROVE)).sendBack).toBe(true);
    expect(selectionActions([charge({ status: 'paid' })], user(FREIGHT.APPROVE, FREIGHT.PAY))).toMatchObject({ approve: false, pay: null, sendBack: false, payBlocked: '' });
    expect(selectionActions([], user(FREIGHT.APPROVE, FREIGHT.PAY))).toMatchObject({ count: 0, approve: false, pay: null });
  });
});

describe('labels', () => {
  it('payment wording', () => {
    expect(referenceLabel('check')).toBe('Check #');
    expect(referenceLabel('ach')).toBe('ACH reference');
    expect(paymentMethodText({ method: 'check', reference: '1042' })).toBe('Check #1042');
    expect(paymentMethodText({ method: 'ach', reference: 'A-5' })).toBe('ACH · A-5');
    expect(paymentMethodText({ method: 'cash' })).toBe('Cash');
    expect(historyLabel('unapproved')).toBe('Sent back to approval');
    expect(historyLabel('something_new')).toBe('something new');
  });

  it('dates', () => {
    expect(todayIso(new Date(2026, 9, 9, 23, 30))).toBe('2026-10-09');
    expect(shortDate('2026-10-09', new Date(2026, 9, 10))).toBe('Oct 9');
    expect(shortDate('2025-12-31', new Date(2026, 9, 10))).toBe('Dec 31, 2025');
    expect(shortDate('', new Date())).toBe('—');
  });

  it('request ids are fresh and fit the server’s pattern', () => {
    const a = newRequestId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(newRequestId()).not.toBe(a);
  });

  it('export rows carry the payment id and the review note', () => {
    const [row] = freightExportRows([charge({ status: 'paid', soNumber: '150352', payment: { paymentId: 'PAY-20261009-K2M8D4RT', paidOn: '2026-10-09', method: 'check', reference: '1042' }, openFlags: [{ detail: 'The delivery was deleted' }] })]);
    expect(row).toMatchObject({ 'SO#': '150352', Amount: 450, Status: 'Paid', Method: 'Check', Reference: '1042', 'Payment ID': 'PAY-20261009-K2M8D4RT', 'Needs review': 'The delivery was deleted' });
  });
});
