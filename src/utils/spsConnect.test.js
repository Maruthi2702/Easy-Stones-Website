import { describe, it, expect } from 'vitest';
import { planConnect, resolveAnswers, spsRowsOf } from './spsConnect.js';

const mapping = { company: 'Name', email: 'Email', phone: 'Phone1', city: 'City' };
const row = (Name, Email = '', Phone1 = '') => ({ Name, Email, Phone1, City: '' });
const cust = (id, company, extra = {}) => ({ _id: id, company, ...extra });

describe('planConnect', () => {
  it('connects an exact name match unasked, capitals ignored', () => {
    const plan = planConnect({ rows: [row('ACME GRANITE')], mapping, customers: [cust('a', 'Acme Granite')] });
    expect(plan.auto).toMatchObject([{ customerId: 'a', key: 'acme granite' }]);
    expect(plan.toCheck).toEqual([]);
  });

  it('keeps inner spacing: two SPS names differing by a space are different', () => {
    const rows = [row('Martinez  Granite'), row('Martinez Granite')];
    const plan = planConnect({ rows, mapping, customers: [cust('a', 'Martinez Granite')] });
    expect(plan.auto.map(a => a.key)).toEqual(['martinez granite']);
  });

  it('does not auto-connect twin customers with one name', () => {
    const plan = planConnect({ rows: [row('Acme')], mapping, customers: [cust('a', 'Acme'), cust('b', 'acme')] });
    expect(plan.auto).toEqual([]);
    expect(plan.toCheck.map(t => t.customerId).sort()).toEqual(['a', 'b']);
    expect(plan.toCheck.every(t => t.twin)).toBe(true);
  });

  it('leaves a customer already connected alone and never offers its name again', () => {
    const plan = planConnect({
      rows: [row('Acme', 'x@acme-stone.com')],
      mapping,
      customers: [cust('a', 'Acme', { sps: { key: 'acme' } }), cust('b', 'Acme Stone', { email: 'x@acme-stone.com' })]
    });
    expect(plan.connected).toBe(1);
    expect(plan.toCheck[0].candidates).toEqual([]);
  });

  it('offers the closest SPS rows by phone and email, strongest first', () => {
    const rows = [row('Precision Stone Designs Inc', '', '(919) 555-0142'), row('Other Co', 'q@other.com', '')];
    const plan = planConnect({
      rows, mapping,
      customers: [cust('p', 'Precision Stone Design', { phone: '919-555-0142' })]
    });
    const [c] = plan.toCheck;
    expect(c.candidates[0]).toMatchObject({ key: 'precision stone designs inc' });
    expect(c.candidates[0].signals).toContain('phone');
  });

  it('adds up: every customer is auto, to check or already connected', () => {
    const customers = [cust('a', 'A'), cust('b', 'B'), cust('c', 'C', { sps: { key: 'c' } }), cust('d', 'D', { sps: { reviewedAs: 'none' } })];
    const plan = planConnect({ rows: [row('A')], mapping, customers });
    expect(plan.auto.length + plan.toCheck.length + plan.connected + plan.notInSps).toBe(plan.total);
    expect(plan.notInSps).toBe(1);
  });

  it('reads one SPS row per name', () => {
    expect(spsRowsOf({ rows: [row('A'), row('a '), row('B')], mapping }).map(r => r.rowNumber)).toEqual([2, 4]);
  });
});

describe('resolveAnswers', () => {
  const rows = [row('Alpha'), row('Beta'), row('Gamma')];
  const plan = planConnect({ rows, mapping, customers: [cust('a', 'Alpha'), cust('x', 'Xeno'), cust('y', 'Yarn')] });
  const spsByKey = new Map(spsRowsOf({ rows, mapping }).map(r => [r.key, r]));

  it('accepts a connection to an offered name, "not in SPS", and "not sure"', () => {
    const r = resolveAnswers(plan, { x: 'beta', y: 'none' }, spsByKey);
    expect(r.connect).toEqual([{ customerId: 'x', key: 'beta' }]);
    expect(r.notInSps).toEqual(['y']);
    expect(resolveAnswers(plan, { x: 'later' }, spsByKey)).toMatchObject({ connect: [], notInSps: [], rejected: [] });
  });

  it('refuses a name another customer holds or is auto-connected to, and one claimed twice', () => {
    const r = resolveAnswers(plan, { x: 'alpha', y: 'beta' }, spsByKey);
    expect(r.rejected.map(x => x.customerId)).toEqual(['x']);
    const twice = resolveAnswers(plan, { x: 'gamma', y: 'gamma' }, spsByKey);
    expect(twice.connect).toHaveLength(1);
    expect(twice.rejected).toHaveLength(1);
  });

  it('refuses names not in the file and customers not waiting', () => {
    const r = resolveAnswers(plan, { x: 'nope', a: 'beta' }, spsByKey);
    expect(r.connect).toEqual([]);
    expect(r.rejected).toHaveLength(2);
  });
});
