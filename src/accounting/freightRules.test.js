import { describe, it, expect } from 'vitest';
import {
  normalizeCarrierName, matchCarrier, qualifiesForCharge, derivedFromDelivery, planSync,
  approveProblem, payProblem, voidProblem, unapproveProblem, editProblem,
  invoiceChargesProblem, invoiceApproveProblem, invoicePayProblem, invoiceVoidProblem,
  paymentBatchProblem, approvesWhenPaid, flagProblem,
  canSeeBranch, branchClause
} from './freightRules.js';

const delivery = (over = {}) => ({
  id: 'del_1', status: 'completed', deliveryType: 'jobsite', date: '2026-10-08', soNumber: '150352',
  customerName: 'Bella Pietra', location: 'Seattle', carrierName: 'ABC Freight', proNumber: 'BOL-9', freightFee: 450, ...over
});

describe('carriers', () => {
  it('matches a typed name however it was spelled', () => {
    expect(normalizeCarrierName('ABC Freight, Inc.')).toBe('abc freight');
    expect(normalizeCarrierName('The A&B Trucking LLC')).toBe('a and b trucking');
    const carriers = [{ _id: 1, name: 'ABC Freight Inc', active: true }, { _id: 2, name: 'Old ABC', aliases: ['abc freight'], active: false }];
    expect(matchCarrier(carriers, 'abc freight').name).toBe('ABC Freight Inc');
    expect(matchCarrier([{ _id: 3, name: 'Western', aliases: ['WX Logistics'] }], 'wx logistics')._id).toBe(3);
    expect(matchCarrier(carriers, '')).toBeNull();
  });
});

describe('which deliveries are owed', () => {
  it('a completed delivery on the 3rd-party truck, but not a will call', () => {
    expect(qualifiesForCharge(delivery(), true)).toBe(true);
    expect(qualifiesForCharge(delivery(), false)).toBe(false);
    expect(qualifiesForCharge(delivery({ status: 'scheduled' }), true)).toBe(false);
    expect(qualifiesForCharge(delivery({ deliveryType: 'will_call' }), true)).toBe(false);
    expect(qualifiesForCharge(delivery({ deliveryType: 'transfer' }), true)).toBe(true);
  });
  it('takes the agreed price as cents, and no price as no amount (not $0)', () => {
    expect(derivedFromDelivery(delivery()).amountCents).toBe(45000);
    expect(derivedFromDelivery(delivery({ freightFee: 0 })).amountCents).toBeNull();
    expect(derivedFromDelivery(delivery({ freightFee: 19.99 })).amountCents).toBe(1999);
  });
});

describe('planSync', () => {
  it('creates a draft for a newly completed delivery from the start date on', () => {
    const plan = planSync({ delivery: delivery(), thirdParty: true, carrierId: 'c1', startDate: '2026-10-01' });
    expect(plan.op).toBe('create');
    expect(plan.doc).toMatchObject({ status: 'draft', deliveryId: 'del_1', amountCents: 45000, carrierId: 'c1', bolNumber: 'BOL-9' });
    expect(planSync({ delivery: delivery({ date: '2026-09-30' }), thirdParty: true, startDate: '2026-10-01' }).op).toBe('none');
    expect(planSync({ delivery: delivery({ status: 'scheduled' }), thirdParty: true }).op).toBe('none');
  });

  it('a draft follows the delivery, except fields corrected by hand', () => {
    const base = planSync({ delivery: delivery(), thirdParty: true }).doc;
    const charge = { ...base, _id: 'x' };
    const plan = planSync({ charge, delivery: delivery({ freightFee: 500, proNumber: 'BOL-10' }), thirdParty: true });
    expect(plan.op).toBe('update');
    expect(plan.set).toMatchObject({ amountCents: 50000, bolNumber: 'BOL-10' });
    const handSet = { ...charge, amountCents: 47500, handSet: ['amountCents'] };
    const plan2 = planSync({ charge: handSet, delivery: delivery({ freightFee: 500 }), thirdParty: true });
    expect(plan2.set.amountCents).toBeUndefined();
    expect(planSync({ charge, delivery: delivery(), thirdParty: true }).op).toBe('none');
  });

  it('an approved charge is frozen: a change raises a flag instead', () => {
    const charge = { ...planSync({ delivery: delivery(), thirdParty: true }).doc, status: 'approved' };
    const plan = planSync({ charge, delivery: delivery({ freightFee: 500 }), thirdParty: true });
    expect(plan.set.amountCents).toBeUndefined();
    expect(plan.flag.code).toBe('delivery_changed');
    expect(plan.flag.detail).toContain('$450.00 → $500.00');
  });

  it('flags, never deletes, when a delivery is no longer owed — once', () => {
    const charge = { ...planSync({ delivery: delivery(), thirdParty: true }).doc };
    const plan = planSync({ charge, delivery: delivery({ status: 'cancelled' }), thirdParty: true });
    expect(plan.flag).toMatchObject({ code: 'delivery_reopened', detail: 'The delivery was cancelled' });
    const flagged = { ...charge, flags: [{ code: 'delivery_reopened', resolvedAt: null }] };
    expect(planSync({ charge: flagged, delivery: null, thirdParty: false }).op).toBe('none');
    // Completed again: the flag clears itself.
    expect(planSync({ charge: flagged, delivery: delivery(), thirdParty: true }).clearReopened).toBe(true);
  });

  it('void and hand-added charges are left alone', () => {
    const charge = { ...planSync({ delivery: delivery(), thirdParty: true }).doc, status: 'void' };
    expect(planSync({ charge, delivery: delivery({ freightFee: 1 }), thirdParty: true }).op).toBe('none');
    expect(planSync({ charge: { source: 'manual', status: 'draft' }, delivery: null }).op).toBe('none');
  });
});

describe('what each status allows', () => {
  const perDelivery = { name: 'ABC', paymentTerms: 'per_delivery' };
  const perInvoice = { name: 'Western', paymentTerms: 'per_invoice' };
  const draft = { status: 'draft', amountCents: 45000, carrierId: 'c1', invoiceId: null };

  it('approval needs an amount, a carrier, and a per-delivery carrier', () => {
    expect(approveProblem(draft, perDelivery)).toBeNull();
    expect(approveProblem({ ...draft, amountCents: null }, perDelivery)).toMatch(/amount/);
    expect(approveProblem({ ...draft, carrierId: null }, null)).toMatch(/carrier/);
    expect(approveProblem(draft, perInvoice)).toMatch(/per invoice/);
    expect(approveProblem({ ...draft, status: 'paid' }, perDelivery)).toMatch(/waiting/);
  });
  it('pay needs approval — unless the payer can approve too (one step); paid and void are final', () => {
    expect(payProblem({ status: 'approved' })).toBeNull();
    expect(payProblem({ status: 'draft' })).toMatch(/Approve/);
    expect(payProblem(draft, { carrier: perDelivery, canApprove: false })).toMatch(/Approve/);
    // One step still runs the approval checks.
    expect(payProblem(draft, { carrier: perDelivery, canApprove: true })).toBeNull();
    expect(payProblem({ ...draft, amountCents: null }, { carrier: perDelivery, canApprove: true })).toMatch(/amount/);
    expect(payProblem(draft, { carrier: perInvoice, canApprove: true })).toMatch(/per invoice/);
    expect(payProblem({ ...draft, invoiceId: 'i' }, { carrier: perDelivery, canApprove: true })).toMatch(/pay the invoice/);
    expect(payProblem({ status: 'void' }, { canApprove: true })).toMatch(/void/);
    expect(approvesWhenPaid(draft)).toBe(true);
    expect(approvesWhenPaid({ status: 'approved' })).toBe(false);
    expect(payProblem({ status: 'paid' })).toMatch(/already/);
    expect(voidProblem({ status: 'paid' })).toMatch(/paid/);
    expect(voidProblem({ status: 'approved' })).toBeNull();
    // An open review flag blocks approve and pay until it's reviewed or voided.
    const deleted = { ...draft, flags: [{ code: 'delivery_reopened', detail: 'The delivery was deleted', resolvedAt: null }] };
    expect(flagProblem(deleted)).toMatch(/The delivery was deleted\. Mark it reviewed/);
    expect(approveProblem(deleted, perDelivery)).toMatch(/deleted/);
    expect(payProblem(deleted, { carrier: perDelivery, canApprove: true })).toMatch(/deleted/);
    expect(payProblem({ ...deleted, status: 'approved' }, { carrier: perDelivery })).toMatch(/deleted/);
    const reviewed = { ...deleted, flags: [{ ...deleted.flags[0], resolvedAt: new Date() }] };
    expect(payProblem(reviewed, { carrier: perDelivery, canApprove: true })).toBeNull();
    expect(voidProblem(deleted)).toBeNull();
    expect(paymentBatchProblem([{ carrierId: 'a' }, { carrierId: 'a' }])).toBeNull();
    expect(paymentBatchProblem([{ carrierId: 'a' }, { carrierId: 'b' }])).toMatch(/one carrier/);
    expect(editProblem({ status: 'approved' })).toMatch(/can't be edited/);
    expect(unapproveProblem({ status: 'approved' })).toBeNull();
    expect(unapproveProblem({ status: 'approved', invoiceId: 'i' })).toMatch(/invoice/);
  });
});

describe('carrier invoices', () => {
  const c = (over) => ({ status: 'draft', carrierId: 'w', amountCents: 10000, soNumber: '1', invoiceId: null, ...over });
  it('charges must be the carrier’s, waiting for approval, and not on another invoice', () => {
    expect(invoiceChargesProblem([c()], 'w')).toBeNull();
    expect(invoiceChargesProblem([], 'w')).toMatch(/at least one/);
    expect(invoiceChargesProblem([c({ carrierId: 'x' })], 'w')).toMatch(/different carrier/);
    expect(invoiceChargesProblem([c({ status: 'approved' })], 'w')).toMatch(/approved/);
    expect(invoiceChargesProblem([c({ invoiceId: 'other' })], 'w', { invoiceId: 'mine' })).toMatch(/another invoice/);
    expect(invoiceChargesProblem([c({ invoiceId: 'mine' })], 'w', { invoiceId: 'mine' })).toBeNull();
  });
  it('the total has to equal the charges to the cent', () => {
    const inv = { status: 'draft', totalCents: 25000 };
    expect(invoiceApproveProblem(inv, [c(), c({ amountCents: 15000 })])).toBeNull();
    expect(invoiceApproveProblem({ ...inv, totalCents: 25001 }, [c(), c({ amountCents: 15000 })])).toMatch(/\$250.00.*\$250.01/);
    expect(invoiceApproveProblem(inv, [c({ amountCents: null })])).toMatch(/no amount/);
    expect(invoicePayProblem({ status: 'draft' })).toMatch(/Approve/);
    expect(invoicePayProblem(inv, [c(), c({ amountCents: 15000 })], { canApprove: true })).toBeNull();
    expect(invoicePayProblem({ ...inv, totalCents: 1 }, [c()], { canApprove: true })).toMatch(/add up/);
    expect(invoicePayProblem({ status: 'approved' })).toBeNull();
    const flaggedCharge = c({ amountCents: 25000, flags: [{ detail: 'The delivery was cancelled', resolvedAt: null }] });
    expect(invoiceApproveProblem(inv, [flaggedCharge])).toMatch(/cancelled/);
    expect(invoicePayProblem({ status: 'approved' }, [flaggedCharge])).toMatch(/cancelled/);
    expect(invoiceVoidProblem({ status: 'paid' })).toMatch(/paid/);
  });
});

describe('branches', () => {
  it('staff see their assigned branches; * sees all', () => {
    expect(canSeeBranch(['Seattle'], 'Seattle')).toBe(true);
    expect(canSeeBranch(['Seattle'], 'Spokane')).toBe(false);
    expect(canSeeBranch(['*'], 'Spokane')).toBe(true);
    expect(branchClause(['Seattle', 'Kent'])).toEqual({ location: { $in: ['Seattle', 'Kent'] } });
    expect(branchClause(['Seattle'], 'Spokane')).toBeNull();
    expect(branchClause(['*'])).toEqual({});
  });
});
