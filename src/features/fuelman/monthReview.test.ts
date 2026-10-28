import { describe, expect, it } from 'vitest';
import { changeFrom, groupCharges, matchUserByName } from './monthReview';
import type { DriverOption, ExpenseLine } from '../../fuelman/types';
const user = (name: string, active = true): DriverOption => ({ key: `user:${name}`, name, active, locations: ['Kent'], kind: 'user' });
describe('matching a report name to a driver', () => {
  const users = [user('Jin Park'), user('Marcus Tran'), user('Denise Okafor'), user('Tom Bradley'), user('Tom Baker')];
  it('matches whole names in either order and initials with a surname', () => {
    expect(matchUserByName('DENISE OKAFOR', users)?.name).toBe('Denise Okafor');
    expect(matchUserByName('Okafor, Denise', users)?.name).toBe('Denise Okafor');
    expect(matchUserByName('J PARK', users)?.name).toBe('Jin Park');
    expect(matchUserByName('MARCUS T', users)?.name).toBe('Marcus Tran');
    expect(matchUserByName('DENISE OKAFO', users)?.name).toBe('Denise Okafor'); // Fuelman cuts names short
  });
  it('offers nothing when it is not clear', () => {
    expect(matchUserByName('TOM B', users)).toBeUndefined(); // Bradley or Baker
    expect(matchUserByName('SHOP TRUCK 3', users)).toBeUndefined();
    expect(matchUserByName('J PARK', [user('Jin Park', false)])).toBeUndefined(); // inactive
  });
});
describe('change versus last month', () => {
  it('rounds to a tenth and flags 10% or more', () => {
    expect(changeFrom(2233000, 1876310)).toEqual({ pct: 19, direction: 'up', flagged: true });
    expect(changeFrom(4061020, 4121055)).toEqual({ pct: -1.5, direction: 'down', flagged: false });
    expect(changeFrom(5, 0).direction).toBe('none'); expect(changeFrom(5, null).flagged).toBe(false);
  });
});
describe('grouping unknown charges', () => {
  const line = (index: number, externalId: string, description: string, amountCents: number) => ({ index, externalId, description, amountCents }) as ExpenseLine;
  it('puts alike charges together whatever their date and amount', () => {
    const groups = groupCharges([line(1, 'A', '07/03 10:15 4411 Washer fluid 2 $19.20', 1920), line(2, 'B', '07/17 08:02 4411 Washer fluid 7 $19.20', 1920), line(3, 'A', '07/28 12:00 Car wash $14.00', 1400)]);
    expect(groups.map(g => [g.lines.length, g.totalCents, g.drivers])).toEqual([[2, 3840, 2], [1, 1400, 1]]);
  });
});
