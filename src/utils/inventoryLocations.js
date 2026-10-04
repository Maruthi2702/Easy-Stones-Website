/**
 * Inventory Analysis's location filter. SPS's "location" isn't only our
 * branches: besides Easy Stones' own warehouses (Seattle today) it names every
 * fabricator holding our stock on consignment — about 90 of them. So the
 * filter lists the two apart, Easy Stones locations first, and never opens on
 * everything at once by accident.
 *
 * Pure and DOM-free; tested in inventoryLocations.test.js.
 */
import { locationNames, homeLocationOf } from './locationFilter.js';

const norm = (s) => String(s || '').trim().toLowerCase();

/**
 * Split the locations found in inventory into Easy Stones' own (matched,
 * ignoring case, against the branch list from Users & Roles → Locations) and
 * consignment (everything else). Each keeps the inventory's own spelling and
 * is sorted A–Z.
 */
export const splitInventoryLocations = (inventoryLocations = [], branches = []) => {
  const ours = new Set(locationNames(branches).map(norm));
  const names = locationNames(inventoryLocations).sort((a, b) => a.localeCompare(b));
  return {
    company: names.filter(n => ours.has(norm(n))),
    consignment: names.filter(n => !ours.has(norm(n)))
  };
};

/**
 * Where the filter opens: the person's home location when it has stock;
 * otherwise every Easy Stones location that does (Seattle today) — so someone
 * whose home branch holds no inventory, or who has none, still sees our own
 * stock rather than ours and all ~90 consignment sites added together. Only
 * when no Easy Stones location has stock at all does it open on everything ([]).
 */
export const defaultInventoryLocations = (user, inventoryLocations = [], branches = []) => {
  const { company } = splitInventoryLocations(inventoryLocations, branches);
  const home = norm(homeLocationOf(user));
  const homeMatch = home && company.find(n => norm(n) === home);
  if (homeMatch) return [homeMatch];
  return company;
};
