import { describe, it, expect } from 'vitest';
import {
  CUSTOMER_PERMISSIONS as P, CUSTOMER_SECTIONS, ALL_CUSTOMER_PERMISSIONS, CUSTOMER_MIGRATION, CUSTOMER_ADMIN_GRANTS,
  canViewCustomers, canViewCustomerProfile, canExportCustomers, canAddCustomer, canImportCustomers,
  canEditCustomers, canDeleteCustomers, BASIC_CUSTOMER_FIELDS, BASIC_CUSTOMER_PROJECTION, basicCustomer,
  CUSTOMER_NEEDS_VIEW, withCustomerViewRule
} from './customerAccess.js';
import { PAGE_PERMISSIONS } from '../features/users/roles/pagePermissions.ts';

const as = (...permissions) => ({ role: 'custom', permissions });

describe('Customers sections', () => {
  it('puts every customer permission in exactly one section', () => {
    const inSections = CUSTOMER_SECTIONS.flatMap((s) => s.keys);
    expect(new Set(inSections).size).toBe(inSections.length);
    expect([...inSections].sort()).toEqual([...ALL_CUSTOMER_PERMISSIONS].sort());
  });
});

describe('the Users & Roles "Customers" card', () => {
  const card = PAGE_PERMISSIONS.find((p) => p.id === 'customers');

  it('has every customer switch, section by section', () => {
    expect(card.actions.map((a) => [a.section, a.key])).toEqual(
      CUSTOMER_SECTIONS.flatMap((s) => s.keys.map((k) => [s.title, k]))
    );
  });

  it('gives every switch a distinct label, a description and an icon', () => {
    for (const a of card.actions) {
      expect(a.label, a.key).toBeTruthy();
      expect(a.desc, a.key).toBeTruthy();
      expect(a.icon, a.key).toBeTruthy();
    }
    expect(new Set(card.actions.map((a) => a.label)).size).toBe(card.actions.length);
  });

  it('is the only card with customer switches', () => {
    const elsewhere = PAGE_PERMISSIONS.filter((p) => p !== card)
      .flatMap((p) => p.actions.map((a) => a.key))
      .filter((k) => ALL_CUSTOMER_PERMISSIONS.includes(k));
    expect(elsewhere).toEqual([]);
  });
});

describe('who may do what', () => {
  it('decides each action by its own switch', () => {
    expect(canViewCustomers(as(P.VIEW))).toBe(true);
    expect(canViewCustomerProfile(as(P.VIEW))).toBe(false);
    expect(canExportCustomers(as(P.VIEW))).toBe(false);
    expect(canAddCustomer(as(P.VIEW))).toBe(false);
    expect(canImportCustomers(as(P.VIEW))).toBe(false);
    expect(canEditCustomers(as(P.VIEW))).toBe(false);
  });

  it('lets a manager add and import without editing or deleting', () => {
    const manager = as(P.VIEW, P.ADD, P.IMPORT);
    expect(canAddCustomer(manager)).toBe(true);
    expect(canImportCustomers(manager)).toBe(true);
    expect(canEditCustomers(manager)).toBe(false);
    expect(canDeleteCustomers(manager)).toBe(false);
  });

  it('deletes only with the Delete switch, never through Edit', () => {
    expect(canDeleteCustomers(as(P.VIEW, P.EDIT))).toBe(false);
    expect(canDeleteCustomers(as(P.VIEW, P.DELETE))).toBe(true);
  });

  it('gives no other switch anything without View (a role saved before the rule)', () => {
    const noView = as(...CUSTOMER_NEEDS_VIEW);
    for (const can of [canViewCustomerProfile, canExportCustomers, canAddCustomer, canImportCustomers, canEditCustomers, canDeleteCustomers]) {
      expect(can(noView), can.name).toBe(false);
    }
  });
});

describe('the card keeps the other switches with View', () => {
  const on = (before, key) => withCustomerViewRule(before, [...before, key]);
  const off = (before, key) => withCustomerViewRule(before, before.filter((k) => k !== key));

  it('turns View on with any other switch', () => {
    for (const key of CUSTOMER_NEEDS_VIEW) expect(on(['view_dashboard'], key).sort()).toEqual(['view_dashboard', key, P.VIEW].sort());
  });

  it('takes every other switch off with View, and leaves other cards alone', () => {
    expect(off(['view_dashboard', ...ALL_CUSTOMER_PERMISSIONS], P.VIEW)).toEqual(['view_dashboard']);
  });

  it('leaves View on when another switch goes off', () => {
    expect(off([P.VIEW, P.ADD, P.IMPORT], P.ADD)).toEqual([P.VIEW, P.IMPORT]);
  });

  it('works for a section turned on or off at once', () => {
    expect(withCustomerViewRule([], [P.ADD, P.IMPORT]).sort()).toEqual([P.ADD, P.IMPORT, P.VIEW].sort());
    expect(withCustomerViewRule([P.VIEW, P.PROFILE, P.EXPORT, P.ADD], [P.ADD])).toEqual([]);
  });

  it('changes nothing for a card other than Customers', () => {
    expect(withCustomerViewRule([P.ADD], [P.ADD, 'view_dashboard'])).toEqual([P.ADD, 'view_dashboard']);
  });
});

describe('the one-time grants', () => {
  it('gives Add and Import to every role that could edit, and nothing else', () => {
    expect(CUSTOMER_MIGRATION).toEqual([{ from: P.EDIT, grant: [P.ADD, P.IMPORT] }]);
  });

  it('starts the full profile and Export with Admin alone', () => {
    const migrated = CUSTOMER_MIGRATION.flatMap((m) => m.grant);
    expect(migrated).not.toContain(P.PROFILE);
    expect(migrated).not.toContain(P.EXPORT);
    expect(CUSTOMER_ADMIN_GRANTS).toEqual(expect.arrayContaining([P.PROFILE, P.EXPORT]));
  });
});

describe('the basic card (no Full profile)', () => {
  const full = {
    _id: 'a1', company: 'Acme', contactName: 'Pat', email: 'p@acme.com', phone: '555', status: 'Onboarded',
    salesRepName: 'Sam', location: 'Kent', address: { city: 'Kent' },
    visits: [{ notes: 'secret' }], resources: [{}], contacts: [{ name: 'Lee' }], associatedCustomers: ['b'],
    level: 'Level - 2', priceLevel: 3, modaDisplay: 'Yes', modaBinder: '2', quickNote: 'private',
    marketingEmail: 'm@acme.com', receiveMarketing: false, followUpDate: '2026-11-01',
    password: 'hash', isActive: false, loginIps: ['1.1.1.1'], coordinates: { lat: 1, lng: 2 }
  };

  it('keeps who and where, and drops everything the profile holds', () => {
    const basic = basicCustomer(full);
    expect(basic).toMatchObject({ company: 'Acme', contactName: 'Pat', email: 'p@acme.com', salesRepName: 'Sam', location: 'Kent' });
    for (const hidden of ['visits', 'resources', 'contacts', 'associatedCustomers', 'level', 'priceLevel', 'modaDisplay',
      'modaBinder', 'quickNote', 'marketingEmail', 'receiveMarketing', 'followUpDate', 'password', 'isActive', 'loginIps', 'coordinates']) {
      expect(basic, hidden).not.toHaveProperty(hidden);
    }
  });

  it('projects exactly the same fields in the list query', () => {
    expect(Object.keys(BASIC_CUSTOMER_PROJECTION).sort()).toEqual([...BASIC_CUSTOMER_FIELDS].sort());
  });
});
