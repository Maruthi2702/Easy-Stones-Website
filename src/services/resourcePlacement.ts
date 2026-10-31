import type { Loose } from '../types/records.ts';

const same = (a: unknown, b: unknown) => Boolean(a && b) && String(a) === String(b);
const text = (value: unknown) => String(value || '').trim();
const day = (value: unknown) => text(value).slice(0, 10);
const purpose = (visit: Loose) => text(visit.purpose).replace(/^Resource Placement:\s*/i, '').toLowerCase();

export class PlacementConflict extends Error {
  status = 409;
  constructor() { super('This older resource has more than one matching placement visit. Review its history before changing it; nothing was saved.'); }
}

/** Legacy matching is exact and unique. Never pick the first repeated title. */
export function placementVisit(customer: Loose, resource: Loose): Loose | null {
  const visits: Loose[] = Array.from(customer.visits || []);
  if (resource.visitId) return visits.find(v => same(v._id, resource.visitId)) || null;
  const linked = visits.find(v => same(v.resourceId, resource._id));
  if (linked) return linked;
  const titles = [resource.title, resource.resourceType].filter(Boolean).map(v => text(v).toLowerCase());
  let matches = visits.filter(v => !v.resourceId && /^Resource Placement:/i.test(text(v.purpose))
    && titles.includes(purpose(v)) && (!resource.date || day(v.date) === day(resource.date))
    && (!(resource.uploadedBy || resource.createdBy) || same(v.createdBy, resource.uploadedBy || resource.createdBy)));
  if (matches.length > 1 && resource.createdAt) {
    const timed = matches.filter(v => text(v.createdAt) === text(resource.createdAt));
    if (timed.length === 1) return timed[0];
  }
  if (matches.length > 1) {
    const notes = text(resource.notes || resource.description || `Added resource: ${resource.title || resource.resourceType}`);
    const noted = matches.filter(v => text(v.notes) === notes);
    if (noted.length === 1) matches = noted;
  }
  if (matches.length > 1) throw new PlacementConflict();
  return matches[0] || null;
}

/** The reverse direction shares the same identity rule when deleting a visit. */
export function placementResource(customer: Loose, visit: Loose): Loose | null {
  const resources: Loose[] = Array.from(customer.resources || []);
  if (visit.resourceId) return resources.find(r => same(r._id, visit.resourceId)) || null;
  const linked = resources.find(r => same(r.visitId, visit._id));
  if (linked) return linked;
  const candidates = resources.filter(r => !r.visitId && [r.title, r.resourceType].some(title => text(title).toLowerCase() === purpose(visit)));
  const matches = candidates.filter(r => same(placementVisit(customer, r)?._id, visit._id));
  if (matches.length > 1) throw new PlacementConflict();
  return matches[0] || null;
}
