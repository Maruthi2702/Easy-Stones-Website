import type { DriverOption, FuelMetadata } from '../../fuelman/types';
export const userDrivers = (metadata: FuelMetadata) => metadata.drivers.filter(d => d.kind === 'user');
export const driverChoices = (drivers: DriverOption[]) => drivers.map(d => ({ value: d.key, label: d.name,
  description: `${d.locations.includes('*') ? 'All locations' : d.locations.join(' / ') || 'No location set'}${d.active ? '' : ' · Inactive: historical reports'}` }));
/** A location hint only after an explicit driver selection; the user confirms it on save. */
export function suggestedLocation(driver: DriverOption | undefined, allowed: string[]) {
  const candidate = driver?.homeLocation || (driver?.locations.length === 1 ? driver.locations[0] : '');
  return candidate && allowed.includes(candidate) ? candidate : '';
}
