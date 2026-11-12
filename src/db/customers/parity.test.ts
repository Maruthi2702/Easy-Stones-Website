import { describe, it, expect } from 'vitest';
import { diffEntries, knownWhy, normalize, profileParityContext } from './parity.ts';
import { contactIdFor } from '../copy/customerRows.ts';
import type { Loose } from '../../types/records.ts';

const cid = '100000000000000000000001', vid = '100000000000000000000002', rid = '100000000000000000000003', ct = '100000000000000000000004';
const emptyCompanyId = '100000000000000000000005', dashboardVisitId = '100000000000000000000006';
const source = [{ _id: cid, company: 'Current company', location: 'Dallas', visits: [{ _id: vid, createdBy: 'test_script' }],
  resources: [{ _id: rid }], contacts: [{}, { _id: ct }] },
  { _id: emptyCompanyId, company: '', contactName: 'Contact', visits: [{ _id: dashboardVisitId }] }];
const profiles = profileParityContext(source);
const unknown = (mongo: unknown, postgres: unknown) => diffEntries(normalize(mongo), normalize(postgres))
  .filter(d => !knownWhy(d, { postgres: normalize(postgres), profiles }));

it('allows a source-branch clock conversion and rejects another branch, a changed time or lost milliseconds', () => {
  const m = [{ _id: cid, contacts: [{ _id: ct, createdAt: '2026-01-01T12:34:56.090Z' }] }];
  const p = (time: string) => [{ _id: cid, contacts: [{ _id: ct, createdAt: time }] }];
  expect(unknown(m, p('2026-01-01T06:34:56.090'))).toEqual([]);
  expect(unknown(m, p('2026-01-01T04:34:56.090'))).toHaveLength(1);
  expect(unknown(m, p('2026-01-01T06:34:55.090'))).toHaveLength(1);
  expect(unknown(m, p('2026-01-01T06:34:56.09'))).toHaveLength(1);
});

it.each([
  ['Tue Feb 03 2026 18:23:17 GMT-0800 (Pacific Standard Time)', '2026-02-03T18:23:17.000'],
  ['2026-02-03T24:23:17.090', '2026-02-03T00:23:17.090']
])('validates the exact legacy local clock: %s', (mongo, postgres) => {
  const doc = (updatedAt: string) => ({ _id: cid, visits: [{ _id: vid, updatedAt }] });
  expect(unknown(doc(mongo), doc(postgres))).toEqual([]);
  expect(unknown(doc(mongo), doc('2026-02-04T00:23:17.090'))).toHaveLength(1);
});

it('allows only the same midnight-UTC follow-up day and same single photo URL', () => {
  const m = { _id: vid, followUpDate: '2026-01-01T00:00:00.000Z', image: '/uploads/same.jpg' };
  expect(unknown(m, { ...m, followUpDate: '2026-01-01', image: ['/uploads/same.jpg'] })).toEqual([]);
  expect(unknown(m, { ...m, followUpDate: '2026-01-02', image: ['/uploads/different.jpg'] })).toHaveLength(2);
  expect(unknown(m, { ...m, image: ['/uploads/same.jpg', '/uploads/extra.jpg'] })).toHaveLength(1);
});

it('recognizes the same source-proven conversions in batched standalone detail responses', () => {
  expect(unknown([{ _id: vid, image: '/same.jpg', followUpDate: '2026-01-01T00:00:00.000Z', createdBy: 'test_script' }],
    [{ _id: vid, image: ['/same.jpg'], followUpDate: '2026-01-01' }])).toEqual([]);
  expect(unknown([{ _id: rid, customer: 'Old' }], [{ _id: rid, customer: 'Current company' }])).toEqual([]);
  expect(unknown([{ _id: cid, image: '/same.jpg' }], [{ _id: cid, image: ['/same.jpg'] }])).toHaveLength(1);
  expect(unknown([{ _id: vid, image: '/same.jpg' }], [{ _id: vid, image: ['/different.jpg'] }])).toHaveLength(1);
});

it('allows only the exact leading-separator change proved by the source empty-company customer', () => {
  const row = { _id: dashboardVisitId, customerId: emptyCompanyId, customerName: ' - Contact' };
  expect(unknown([row], [{ ...row, customerName: 'Contact' }])).toEqual([]);
  expect(unknown([row], [{ ...row, customerName: 'Wrong contact' }])).toHaveLength(1);
  expect(unknown([{ ...row, customerId: cid }], [{ ...row, customerId: cid, customerName: 'Contact' }])).toHaveLength(1);
  expect(unknown([{ ...row, _id: cid }], [{ ...row, _id: cid, customerName: 'Contact' }])).toHaveLength(1);
});

it('applies the photo, follow-up and name allowances only to visits and resources', () => {
  const photo = { mongo: '/a.jpg', postgres: ['/a.jpg'] };
  expect(unknown([{ _id: cid, resources: [{ _id: rid, image: photo.mongo }] }], [{ _id: cid, resources: [{ _id: rid, image: photo.postgres }] }])).toEqual([]);
  expect(unknown({ _id: cid, partner: { image: photo.mongo } }, { _id: cid, partner: { image: photo.postgres } })).toHaveLength(1);
  expect(unknown({ _id: cid, login: { followUpDate: '2026-01-01T00:00:00.000Z' } }, { _id: cid, login: { followUpDate: '2026-01-01' } })).toHaveLength(1);
  expect(unknown({ _id: cid, associatedCustomers: [{ _id: rid, customer: 'Old' }] }, { _id: cid, associatedCustomers: [{ _id: rid, customer: 'Current company' }] })).toHaveLength(1);
});

it('allows only the source parent name for a resource, for profile and standalone responses', () => {
  const doc = (customer: string) => ({ _id: rid, customer });
  for (const wrap of [(r: Loose) => r, (r: Loose) => [{ _id: cid, resources: [r] }]]) {
    expect(unknown(wrap(doc('Old name')), wrap(doc('Current company')))).toEqual([]);
    expect(unknown(wrap(doc('Old name')), wrap(doc('Wrong company')))).toHaveLength(1);
  }
});

it('allows only a copied non-account author to disappear; valid actors and other missing fields fail', () => {
  expect(unknown({ _id: vid, createdBy: 'test_script' }, { _id: vid })).toEqual([]);
  expect(unknown({ _id: vid, createdBy: cid }, { _id: vid })).toHaveLength(1);
  expect(unknown({ _id: rid, createdBy: 'test_script' }, { _id: rid })).toHaveLength(1);
  expect(unknown({ _id: vid, createdByName: 'Someone' }, { _id: vid })).toHaveLength(1);
});

it('allows only an actually generated contact id and the explicitly false unused default', () => {
  const m = [{ _id: cid, contacts: [{ name: 'Old', isPrimary: false }] }];
  expect(unknown(m, [{ _id: cid, contacts: [{ _id: contactIdFor(cid, 0), name: 'Old' }] }])).toEqual([]);
  expect(unknown(m, [{ _id: cid, contacts: [{ _id: ct, name: 'Old' }] }])).toHaveLength(1);
  expect(unknown([{ contacts: [{ isPrimary: true }] }], [{ contacts: [{}] }])).toHaveLength(1);
});

describe('numeric and missing-history differences stay failures', () => {
  it('never masks counts, dates, missing visits or attachment order', () => {
    const m = { _id: cid, visits: [{ _id: vid, date: '2026-11-09', image: ['a', 'b'] }], contactsCount: 2 };
    expect(unknown(m, { ...m, contactsCount: 1 })).toHaveLength(1);
    expect(unknown(m, { ...m, visits: [] }).length).toBeGreaterThan(0);
    expect(unknown(m, { ...m, visits: [{ ...m.visits[0], date: '2026-11-08', image: ['b', 'a'] }] })).toHaveLength(3);
  });
});
