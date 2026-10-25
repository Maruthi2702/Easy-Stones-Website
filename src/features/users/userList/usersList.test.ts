import { describe, it, expect } from 'vitest';
import { filterUsers, roleDisplayName } from './usersList';
import { presenceById } from '../../../utils/userPresence';
import type { RoleRecord, UserRecord } from '../types';

const users: UserRecord[] = [
  { _id: 'u1', username: 'krish', displayName: 'Krish', email: 'k@es.com', role: 'admin', location: 'Seattle' },
  { _id: 'u2', username: 'rita', displayName: 'Rita Moreno', email: 'rita@es.com', role: 'sales_rep', location: 'Spokane' },
  { _id: 'u3', username: 'sam', role: 'driver' }
];
const live = presenceById([{ userId: 'u2', status: 'active', tabs: 1 }]);

describe('filterUsers', () => {
  it('keeps everyone with no search', () => expect(filterUsers(users, '  ', false, live)).toBe(users));
  it('matches username, display name, email, role and home location, ignoring case', () => {
    expect(filterUsers(users, 'KRI', false, live).map((u) => u._id)).toEqual(['u1']);
    expect(filterUsers(users, 'moreno', false, live).map((u) => u._id)).toEqual(['u2']);
    expect(filterUsers(users, 'k@es', false, live).map((u) => u._id)).toEqual(['u1']);
    expect(filterUsers(users, 'driver', false, live).map((u) => u._id)).toEqual(['u3']);
    expect(filterUsers(users, 'spokane', false, live).map((u) => u._id)).toEqual(['u2']);
  });
  it('"Online now" keeps people with a tab open, then searches them', () => {
    expect(filterUsers(users, '', true, live).map((u) => u._id)).toEqual(['u2']);
    expect(filterUsers(users, 'krish', true, live)).toEqual([]);
  });
});

describe('roleDisplayName', () => {
  const roles = [{ _id: 'r1', name: 'sales_rep', displayName: 'Sales Rep' }] as RoleRecord[];
  it("uses the role's display name", () => expect(roleDisplayName(roles, 'sales_rep')).toBe('Sales Rep'));
  it('falls back to the key in capitals (first underscore only, as before)', () => {
    expect(roleDisplayName(roles, 'office_lead_csr')).toBe('OFFICE LEAD_CSR');
  });
});
