import type { DriverOption, ExpenseLine, FuelMetadata, ReportDetail, ReviewDriver } from '../../fuelman/types';
import { suggestedLocation } from './driverChoices';
// Rules for the one-page monthly review: what needs a person, and what can be offered ready-made.

const words = (name: string) => name.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
/** The one active system driver a report name plainly refers to ("J PARK" → Jin Park), else none. */
export function matchUserByName(reported: string, users: DriverOption[]): DriverOption | undefined {
  const a = words(reported);
  if (!a.length) return undefined;
  // Fuelman cuts names short ("MARCUS T", "DRIVER ALP"), so each reported word may be the start of the
  // user's first or last name, in either order. Two people it could be means we offer nothing.
  const starts = (part: string, name: string) => name.startsWith(part);
  const same = (u: DriverOption) => {
    const b = words(u.name);
    if (a.length === b.length && [...a].sort().join(' ') === [...b].sort().join(' ')) return true;
    if (a.length !== 2 || b.length < 2) return false;
    const [x, y] = a as [string, string], first = b[0]!, last = b.at(-1)!;
    return (starts(x, first) && starts(y, last)) || (starts(x, last) && starts(y, first));
  };
  const found = users.filter(u => u.active && same(u));
  return found.length === 1 ? found[0] : undefined;
}
// `since` is set when the answer is the one saved for a later month (an earlier report being reviewed after it).
export interface CardSuggestion { driver: ReviewDriver; user: DriverOption | undefined; location: string; since?: string }
/** A reported card with no saved match, plus the ready-made answer when the name and home location are clear. */
export function suggestionsFor(report: ReportDetail, metadata: FuelMetadata): CardSuggestion[] {
  const users = metadata.drivers.filter(d => d.kind === 'user');
  return report.review.drivers.filter(d => !d.driverKey).map(driver => {
    // What this same card was matched to in a later month beats guessing from the name.
    const later = driver.carriedFrom, saved = later && users.find(u => u.key === later.driverKey);
    if (later && saved) return { driver, user: saved, location: metadata.locations.includes(later.location) ? later.location : '', since: later.since };
    const user = matchUserByName(driver.name, users);
    return { driver, user, location: suggestedLocation(user, metadata.locations) };
  });
}
/** Past this many unmatched cards the month is a set-up month: one batch form, not a list of cards. */
export const SETUP_THRESHOLD = 8;
export const isSetupMonth = (report: ReportDetail) => report.review.drivers.filter(d => !d.driverKey).length > SETUP_THRESHOLD;

export interface Change { pct: number | null; direction: 'up' | 'down' | 'same' | 'none'; flagged: boolean }
/** Percent change versus last month; a change of 10% or more is worth a glance. */
export function changeFrom(now: number, before: number | null | undefined): Change {
  if (!before) return { pct: null, direction: 'none', flagged: false };
  const pct = Math.round(((now - before) / Math.abs(before)) * 1000) / 10;
  return { pct, direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'same', flagged: Math.abs(pct) >= 10 };
}
export interface LocationRow { location: string; cents: number; previous: number | null; change: Change; scale: number; previousScale: number | null }
export function locationRows(report: ReportDetail): LocationRow[] {
  const before = new Map((report.compare?.locations || []).map(l => [l.location, l.previousCents]));
  const rows = report.review.locations.map(l => ({ location: l.location, cents: l.totalCents, previous: report.compare ? before.get(l.location) ?? 0 : null }));
  const max = Math.max(1, ...rows.flatMap(r => [Math.abs(r.cents), Math.abs(r.previous ?? 0)])) / 0.9;
  return rows.map(r => ({ ...r, change: changeFrom(r.cents, r.previous), scale: Math.abs(r.cents) / max * 100, previousScale: r.previous === null ? null : Math.abs(r.previous) / max * 100 }));
}

/** Unknown charges that read alike are one decision. The key ignores dates, times, amounts and numbers. */
export function chargeText(line: Pick<ExpenseLine, 'description'>): string {
  return line.description.replace(/^\d{2}\/\d{2}\s+\d{2}:\d{2}\s*/, '').replace(/-?\$[\d,]+\.\d{2}/g, '').replace(/\s+/g, ' ').trim();
}
export interface ChargeGroup { key: string; label: string; lines: ExpenseLine[]; totalCents: number; drivers: number }
export function groupCharges(lines: ExpenseLine[]): ChargeGroup[] {
  const groups = new Map<string, ChargeGroup>();
  for (const line of lines) {
    const label = chargeText(line), key = label.toLowerCase().replace(/\d+/g, '#');
    const group = groups.get(key) || { key, label, lines: [], totalCents: 0, drivers: 0 };
    group.lines.push(line); group.totalCents += line.amountCents; groups.set(key, group);
  }
  return [...groups.values()].map(g => ({ ...g, drivers: new Set(g.lines.map(l => l.externalId)).size })).sort((a, b) => b.lines.length - a.lines.length || a.label.localeCompare(b.label));
}
