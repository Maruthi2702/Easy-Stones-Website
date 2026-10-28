import type { Assignment, DriverOption, ReviewDriver } from './types.ts';
/**
 * A driver matched in a later month who is reviewed in an earlier one (August after September) needs no answer when the
 * evidence agrees: the later match is one clear location, and that driver's own Users & Roles account has that location
 * and no other. Drivers rarely move, so this saves a click per card; anyone whose account says otherwise (several
 * locations, all locations, a different one) is left as a card for a person to confirm.
 *
 * These are only ever built while reviewing: nothing is stored until the month is approved, and a later answer given
 * by hand takes their place (the driver is then covered by a real assignment and is no longer a candidate).
 */
export function impliedAssignments(drivers: ReviewDriver[], options: DriverOption[]): Assignment[] {
  const byKey = new Map(options.filter(o => o.kind === 'user').map(o => [o.key, o]));
  return drivers.flatMap(d => {
    const later = d.carriedFrom, user = later && byKey.get(later.driverKey);
    if (!later || !user || user.locations.length !== 1 || user.locations[0] !== later.location) return [];
    return [{ id: `implied:${d.externalId}`, externalId: d.externalId, reportedName: d.name, driverKey: later.driverKey, driverName: later.driverName,
      from: d.suggestedFrom, to: later.since, allocations: [{ location: later.location, basisPoints: 10000 }], implied: true }];
  });
}
