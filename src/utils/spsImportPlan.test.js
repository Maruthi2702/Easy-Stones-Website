import { describe, it, expect } from 'vitest';
import { planSpsImport, blockersFor, switchesNeeded, ANSWER } from './spsImportPlan.js';

const mapping = { company: 'Name', salesRep: 'Sales Person1', location: 'Parent Location', email: 'Email', phone: 'Phone1', city: 'City' };
const row = (Name, extra = {}) => ({ Name, 'Sales Person1': '', 'Parent Location': '', Email: '', Phone1: '', City: '', ...extra });
const STEVE = { salesRep: 'u1', salesRepName: 'Steve Watson' };
const repByKey = new Map([['stevewatson', STEVE]]);
const branchByKey = new Map([['seattle', 'Seattle'], ['atlanta', 'Atlanta']]);
const cust = (id, company, extra = {}) => ({ _id: id, company, email: `${id}@x.com`, ...extra });
const plan = (o) => planSpsImport({ mapping, branchByKey, repByKey, customers: [], deleted: [], ...o });
const one = (p, key) => p.outcomes.find((x) => x.key === key);

describe('planSpsImport', () => {
  it('gives every distinct SPS name exactly one outcome that adds up to the file', () => {
    const p = plan({
      rows: [row('A'), row('B'), row('b'), row('')],
      customers: [cust('a', 'A', { sps: { key: 'a' } })]
    });
    expect(p.outcomes.map((o) => o.key)).toEqual(['a', 'b']);
    expect(p.skipped).toEqual({ blank: 1, repeated: 1 });
    expect(p.adds).toBe(true);
    expect(p.counts).toMatchObject({ unchanged: 1, new: 1 });
  });

  it('updates a held key; the rep is SPS’s, the branch is SPS’s, the rest only fills blanks', () => {
    const target = cust('a', 'Acme', { sps: { key: 'acme' }, salesRep: 'u0', salesRepName: 'Old Rep', location: 'Seattle', phone: '555', address: { street: '', city: 'Kent' } });
    const p = plan({
      rows: [row('Acme', { 'Sales Person1': 'Steve Watson', 'Parent Location': 'Atlanta', Phone1: '999', City: 'Dallas' })],
      customers: [target]
    });
    const o = one(p, 'acme');
    expect(o.action).toBe('update');
    expect(o.apply).toMatchObject({ salesRep: 'u1', salesRepName: 'Steve Watson', location: 'Atlanta' });
    expect(o.apply.phone).toBeUndefined();            // typed in Easy Stones: kept
    expect(o.apply['address.city']).toBeUndefined();
    expect(o.before).toMatchObject({ salesRepName: 'Old Rep', location: 'Seattle' });
  });

  it('keeps our rep when SPS has none', () => {
    const t = cust('a', 'Acme', { sps: { key: 'acme' }, salesRep: 'u0', salesRepName: 'Old Rep' });
    expect(one(plan({ rows: [row('Acme')], customers: [t] }), 'acme').action).toBe('unchanged');
  });

  it('connects an exact company name that has no key yet', () => {
    const o = one(plan({ rows: [row('ACME STONE')], customers: [cust('a', 'Acme Stone')] }), 'acme stone');
    expect(o).toMatchObject({ action: 'update', connect: true, customerId: 'a' });
    expect(o.apply['sps.key']).toBe('acme stone');
    expect(o.unset).toContain('sps.key');
  });

  it('adds a stranger as new, with its own email or a placeholder', () => {
    const p = plan({ rows: [row('Zed', { Email: 'z@zed.com' }), row('Yan')] });
    expect(one(p, 'zed').create.email).toBe('z@zed.com');
    expect(one(p, 'yan').create.email).toMatch(/^na\+yan@easystones-client\.com$/);
  });

  it('asks about a look-alike, defaulting to new; an answer connects it', () => {
    const customers = [cust('p', 'Precision Stone Design', { phone: '919-555-0142' })];
    const rows = [row('Precision Stone Designs Inc', { Phone1: '(919) 555-0142' })];
    const asked = plan({ rows, customers });
    expect(one(asked, 'precision stone designs inc')).toMatchObject({ action: 'decision' });
    expect(asked.counts.decision).toBe(1);
    // the screen lays the customer out field by field, so the fields travel separately
    expect(one(asked, 'precision stone designs inc').matches[0]).toMatchObject({ company: 'Precision Stone Design', phone: '919-555-0142', email: 'p@x.com' });

    expect(one(plan({ rows, customers, finalize: true }), 'precision stone designs inc').action).toBe('new');
    expect(one(plan({ rows, customers, answers: { 'precision stone designs inc': ANSWER.NEW } }), 'precision stone designs inc').action).toBe('new');
    const joined = one(plan({ rows, customers, answers: { 'precision stone designs inc': 'p' } }), 'precision stone designs inc');
    expect(joined).toMatchObject({ action: 'update', connect: true, customerId: 'p' });
  });

  it('never lets two rows claim one customer', () => {
    const customers = [cust('p', 'Acme Stone', { phone: '919-555-0142' })];
    const p = plan({ rows: [row('Acme Stone'), row('Acme Stone Co', { Phone1: '919-555-0142' })], customers, finalize: true });
    const claims = p.outcomes.filter((o) => o.customerId === 'p');
    expect(claims).toHaveLength(1);
    expect(one(p, 'acme stone co').action).toBe('new');
  });

  it('asks about a deleted customer and blocks until answered', () => {
    const deleted = [{ _id: 'b1', customerId: 'd1', customer: { company: 'Granite Masters Inc' }, deletedBy: 'Maria', deletedAt: '2026-10-12', source: 'bulk', batchId: 'x' }];
    const rows = [row('Granite Masters Inc')];
    const open = plan({ rows, deleted });
    expect(one(open, 'granite masters inc')).toMatchObject({ action: 'deleted', deleted: { deletedBy: 'Maria' } });
    expect(blockersFor(open)[0]).toMatch(/deleted/);

    const back = plan({ rows, deleted, answers: { 'granite masters inc': ANSWER.RESTORE } });
    expect(one(back, 'granite masters inc')).toMatchObject({ action: 'restore', customerId: 'd1' });
    expect(blockersFor(back)).toEqual([]);
    expect(switchesNeeded(back)).toEqual({ edit: false, add: true });

    const kept = plan({ rows, deleted, answers: { 'granite masters inc': ANSWER.KEEP_DELETED } });
    expect(one(kept, 'granite masters inc').action).toBe('keptDeleted');
  });

  it('ignores a deleted copy that is back, was undone, or came from an import undo', () => {
    const rows = [row('Gone Co')];
    const mk = (extra) => [{ customerId: 'd1', customer: { company: 'Gone Co' }, ...extra }];
    expect(one(plan({ rows, deleted: mk({ undoneAt: new Date() }) }), 'gone co').action).toBe('new');
    expect(one(plan({ rows, deleted: mk({ source: 'sps-undo' }) }), 'gone co').action).toBe('new');
    expect(one(plan({ rows, deleted: mk({}), customers: [cust('d1', 'Gone Co', { sps: { key: 'gone co' } })] }), 'gone co').action).toBe('unchanged');
  });

  it('remembers a keep-deleted answer', () => {
    const deleted = [{ customerId: 'd1', customer: { company: 'Gone Co' }, spsKeepDeleted: true }];
    expect(one(plan({ rows: [row('Gone Co')], deleted }), 'gone co')).toMatchObject({ action: 'keptDeleted', remembered: true });
  });

  it('asks once about unknown rep and branch names', () => {
    const p = plan({ rows: [row('A', { 'Sales Person1': 'Stephen Watson', 'Parent Location': 'FWB' }), row('B', { 'Sales Person1': 'Stephen Watson' })] });
    expect(p.unresolvedReps).toEqual([{ given: 'Stephen Watson', rowCount: 2, suggestion: 'Steve Watson' }]);
    expect(p.unresolvedBranches[0]).toMatchObject({ given: 'FWB', rowCount: 1 });
    expect(blockersFor(p)).toHaveLength(2);
  });
});
