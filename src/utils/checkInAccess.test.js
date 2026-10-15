import { describe, it, expect } from 'vitest';
import {
  CHECKIN_PERMISSIONS as P, CHECKIN_SECTIONS, ALL_CHECKIN_PERMISSIONS, CHECKIN_MIGRATION,
  DETAIL_FIELDS, SHEET_FIELDS, missingEditPermission,
  canCheckIn, canSeeCheckInQr, canViewCheckInLog, canEditCheckInDetails, canDeleteCheckIn,
  canEditSelectionSheet, canEmailSelectionSheet
} from './checkInAccess.js';
import { sheetPayload, sheetValuesFromCheckIn } from './selectionSheet.js';
import { PAGE_PERMISSIONS } from '../components/sales/users/pagePermissions.js';

const as = (...permissions) => ({ role: 'custom', permissions });

describe('Check In sections', () => {
  it('puts every check-in permission in exactly one section', () => {
    const inSections = CHECKIN_SECTIONS.flatMap((s) => s.keys);
    expect(new Set(inSections).size).toBe(inSections.length);
    expect([...inSections].sort()).toEqual([...ALL_CHECKIN_PERMISSIONS].sort());
  });

  it('has Check In (with QR / NFC), then the Check-In Log, then the Selection Sheet', () => {
    expect(CHECKIN_SECTIONS.map((s) => [s.title, s.keys])).toEqual([
      ['Check In', ['create_checkins', 'view_checkin_qr']],
      ['Check-In Log', ['view_checkins', 'manage_checkins', 'delete_checkins']],
      ['Selection Sheet', ['edit_selection_sheets', 'send_checkin_email']]
    ]);
  });
});

describe('the Users & Roles "Check In" card', () => {
  const card = PAGE_PERMISSIONS.find((p) => p.id === 'checkins');

  it('is one card called Check In with every check-in switch, section by section', () => {
    expect(card.page).toBe('Check In');
    expect(card.actions.map((a) => [a.section, a.key])).toEqual(
      CHECKIN_SECTIONS.flatMap((s) => s.keys.map((k) => [s.title, k]))
    );
  });

  it('gives every switch a label, a description and an icon', () => {
    for (const a of card.actions) {
      expect(a.label, a.key).toBeTruthy();
      expect(a.desc, a.key).toBeTruthy();
      expect(a.icon, a.key).toBeTruthy();
    }
    // Two Edit switches: the card's pills have to tell them apart.
    expect(new Set(card.actions.map((a) => a.label)).size).toBe(card.actions.length);
  });

  it('is the only card with check-in switches', () => {
    const elsewhere = PAGE_PERMISSIONS.filter((p) => p !== card)
      .flatMap((p) => p.actions.map((a) => a.key))
      .filter((k) => ALL_CHECKIN_PERMISSIONS.includes(k));
    expect(elsewhere).toEqual([]);
  });
});

describe('who may do what', () => {
  it('decides each action by its own switch, never by role name', () => {
    const everything = { role: 'admin', permissions: [...ALL_CHECKIN_PERMISSIONS] };
    for (const can of [canCheckIn, canSeeCheckInQr, canViewCheckInLog, canEditCheckInDetails, canDeleteCheckIn, canEditSelectionSheet, canEmailSelectionSheet]) {
      expect(can(everything)).toBe(true);
      expect(can({ role: 'admin', permissions: [] })).toBe(false);
      expect(can(null)).toBe(false);
    }
  });

  it('keeps checking in separate from editing', () => {
    expect(canCheckIn(as(P.EDIT_DETAILS, P.EDIT_SHEET))).toBe(false);
    expect(canCheckIn(as(P.CHECK_IN))).toBe(true);
    expect(canEditCheckInDetails(as(P.CHECK_IN))).toBe(false);
  });
});

describe('missingEditPermission — what a PUT /api/checkin/:id needs', () => {
  const details = { name: 'Pat', phone: '(206) 555-0142', location: 'Seattle' };
  const sheet = { selections: [], specialNotes: 'x', salesRep: 'Rita' };

  it('visitor details need Edit details', () => {
    expect(missingEditPermission(as(P.EDIT_DETAILS), details)).toBe(null);
    expect(missingEditPermission(as(P.EDIT_SHEET), details)).toBe(P.EDIT_DETAILS);
  });

  it('sheet fields need Edit sheets', () => {
    expect(missingEditPermission(as(P.EDIT_SHEET), sheet)).toBe(null);
    expect(missingEditPermission(as(P.EDIT_DETAILS), sheet)).toBe(P.EDIT_SHEET);
  });

  it('a body with both needs both', () => {
    expect(missingEditPermission(as(P.EDIT_DETAILS), { ...details, ...sheet })).toBe(P.EDIT_SHEET);
    expect(missingEditPermission(as(P.EDIT_SHEET), { ...details, ...sheet })).toBe(P.EDIT_DETAILS);
    expect(missingEditPermission(as(P.EDIT_DETAILS, P.EDIT_SHEET), { ...details, ...sheet })).toBe(null);
  });

  it('a body with neither needs one of them, and View is never enough', () => {
    expect(missingEditPermission(as(P.EDIT_SHEET), { expectedUpdatedAt: 'x' })).toBe(null);
    expect(missingEditPermission(as(P.VIEW_LOG), {})).toBe(P.EDIT_DETAILS);
    expect(missingEditPermission(as(P.VIEW_LOG), details)).toBe(P.EDIT_DETAILS);
    expect(missingEditPermission(as(P.VIEW_LOG), undefined)).toBe(P.EDIT_DETAILS);
  });

  it('the Selection Sheet\'s own save needs only Edit sheets', () => {
    const body = sheetPayload(sheetValuesFromCheckIn({ name: 'Pat', selections: [{ material: 'X' }] }), new Date().toISOString());
    expect(Object.keys(body).filter((k) => k !== 'expectedUpdatedAt').every((k) => SHEET_FIELDS.includes(k))).toBe(true);
    expect(missingEditPermission(as(P.EDIT_SHEET), body)).toBe(null);
    expect(missingEditPermission(as(P.EDIT_DETAILS), body)).toBe(P.EDIT_SHEET);
  });

  it('no field is under both switches', () => {
    expect(DETAIL_FIELDS.filter((f) => SHEET_FIELDS.includes(f))).toEqual([]);
  });
});

describe('the one-time migration', () => {
  it('gives Check in and Edit sheets to every role that could edit check-ins', () => {
    expect(CHECKIN_MIGRATION).toEqual([{ from: 'manage_checkins', grant: ['create_checkins', 'edit_selection_sheets'] }]);
  });
});
