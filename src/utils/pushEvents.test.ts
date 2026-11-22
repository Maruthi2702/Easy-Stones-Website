import { describe, expect, it } from 'vitest';
import {
  checkInRecipients, driverAssignedMessage, driverChanged, driverUserFor, followUpClock, followUpsDueMessage,
  receiptSentBackMessage, reportRecipients, reportSubmittedMessage
} from './pushEvents.ts';

const staff = [
  { _id: 'u1', username: 'jsmith', displayName: 'Jo Smith', role: 'driver', location: 'Seattle', assignedLocations: ['Seattle'] },
  { _id: 'u2', username: 'ann', displayName: 'Ann Lee', role: 'sales_rep', location: 'Seattle', assignedLocations: ['Seattle'] },
  { _id: 'u3', username: 'bo', displayName: 'Bo Ray', role: 'sales_rep', location: 'Seattle', assignedLocations: ['Seattle'] },
  { _id: 'u4', username: 'cy', displayName: 'Cy Fox', role: 'sales_rep', location: 'Dallas', assignedLocations: ['Dallas'] },
  { _id: 'u5', username: 'dee', displayName: 'Dee Kay', role: 'sales_rep', location: 'Seattle', assignedLocations: ['*'] },
  { _id: 'u6', username: 'eve', displayName: 'Eve Oh', role: 'sales_rep', location: 'Seattle', assignedLocations: ['Seattle'], isActive: false },
  { _id: 'u7', username: 'mgr', displayName: 'Mo Gr', role: 'manager', location: 'Seattle', assignedLocations: ['Seattle'] }
];

describe('receipt sent back', () => {
  it('says the merchant, the amount and the reason', () => {
    const m = receiptSentBackMessage({ merchant: 'Home Depot', cents: 12345 }, 'Missing the tip');
    expect(m).toEqual({ title: 'Receipt sent back', body: 'Home Depot · $123.45 — Missing the tip', path: '/sales?tab=card_receipts' });
  });
  it('works with no comment', () => {
    expect(receiptSentBackMessage({ merchant: 'Shell', cents: 500 }, '').body).toBe('Shell · $5.00');
  });
});

describe('delivery assigned to a driver', () => {
  it('finds the driver by the board column, ignoring case and deactivated logins', () => {
    expect(driverUserFor('drv_JSmith', staff)?._id).toBe('u1');
    expect(driverUserFor('drv_jsmith', [{ ...staff[0], isActive: false }])).toBeNull();
    expect(driverUserFor('3rd_party', staff)).toBeNull();
    expect(driverUserFor('', staff)).toBeNull();
  });
  it('speaks only when the ticket lands on a different driver', () => {
    expect(driverChanged('', 'drv_jsmith')).toBe(true);
    expect(driverChanged('drv_ann', 'drv_jsmith')).toBe(true);
    expect(driverChanged('drv_jsmith', 'drv_jsmith')).toBe(false);
    expect(driverChanged('drv_jsmith', '')).toBe(false);
    expect(driverChanged('', 'third_party')).toBe(false);
  });
  it('names the customer and the day', () => {
    expect(driverAssignedMessage({ customerName: 'Acme Tile', date: '2026-11-23' }).body).toBe('Acme Tile on 2026-11-23');
    expect(driverAssignedMessage({}).body).toBe('a delivery');
  });
});

describe('daily report submitted', () => {
  it('goes to the active people on the location list', () => {
    expect(reportRecipients(['u2', 'u6', 'u9'], staff)).toEqual(['u2']);
    expect(reportRecipients(undefined, staff)).toEqual([]);
  });
  it('says who submitted, or that it was automatic', () => {
    expect(reportSubmittedMessage({ location: 'Seattle', date: '2026-11-21', submittedBy: 'Scott' }).body).toBe('Seattle · 2026-11-21 · submitted by Scott');
    expect(reportSubmittedMessage({ location: 'Seattle', date: '2026-11-21', autoSubmitted: true }).body).toContain('automatically');
  });
});

describe('check-in recipients', () => {
  it('goes to the rep named on it', () => {
    expect(checkInRecipients({ location: 'Seattle', salesRep: 'ann lee' }, staff)).toEqual(['u2']);
  });
  it('with no rep goes to the branch\'s active sales reps, not other branches, all-location logins or managers', () => {
    expect(checkInRecipients({ location: 'Seattle' }, staff)).toEqual(['u2', 'u3']);
    expect(checkInRecipients({ location: 'Dallas' }, staff)).toEqual(['u4']);
  });
  it('never the person who logged it', () => {
    expect(checkInRecipients({ location: 'Seattle', loggedBy: { userId: 'u2' } }, staff)).toEqual(['u3']);
    expect(checkInRecipients({ location: 'Seattle', salesRep: 'Ann Lee', loggedBy: { userId: 'u2' } }, staff)).toEqual([]);
  });
});

describe('follow-ups due', () => {
  it('counts in the words', () => {
    expect(followUpsDueMessage(1).body).toBe('You have 1 follow-up due today');
    expect(followUpsDueMessage(3).body).toBe('You have 3 follow-ups due today');
  });
  it('is the push hour at 8 AM on the branch\'s own clock', () => {
    // 16:30 UTC on 2026-11-21 is 8:30 in Seattle, 11:30 in Atlanta
    const at = new Date('2026-11-21T16:30:00Z');
    expect(followUpClock('Seattle', at)).toEqual({ today: '2026-11-21', isPushHour: true });
    expect(followUpClock('Atlanta', at).isPushHour).toBe(false);
  });
});
