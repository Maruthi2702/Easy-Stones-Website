import { describe, it, expect } from 'vitest';
import { toSalesRepList, isSalesRep } from './salesReps.js';

describe('toSalesRepList', () => {
  const staff = [
    { _id: '1', username: 'kim', name: 'Kim', role: 'sales_rep', location: 'Seattle' },
    { _id: '2', username: 'sergio', name: 'Sergio', role: 'driver', location: 'Seattle' },
    { _id: '3', username: 'ann', name: 'Ann', role: 'manager', location: 'Seattle', isActive: false },
    { _id: '4', username: 'admin', name: 'Admin', role: 'admin', location: 'Seattle' },
    { _id: '5', username: 'bo', name: 'Bo', role: 'sales_rep', location: 'Spokane' }
  ];

  it('offers account owners only, by branch then name', () => {
    expect(toSalesRepList({ data: staff.filter(u => u.isActive !== false) }).map(u => u.name)).toEqual(['Kim', 'Bo']);
  });

  it('keeps a deactivated rep, marked and listed last, so their customers still show and can be handed over', () => {
    const list = toSalesRepList(staff);
    expect(list.map(u => u.name)).toEqual(['Kim', 'Bo', 'Ann (inactive)']);
    expect(list[2].inactive).toBe(true);
  });

  it('returns nothing usable from a server that sends no ids', () => {
    expect(toSalesRepList([{ username: 'kim', role: 'sales_rep' }])).toEqual([]);
  });

  it('never offers the shared admin login', () => {
    expect(isSalesRep({ _id: '4', username: 'admin', role: 'admin' })).toBe(false);
  });
});
