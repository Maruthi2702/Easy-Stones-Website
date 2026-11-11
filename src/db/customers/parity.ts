/**
 * Compare what MongoDB and Postgres answer for the same read, as the screens would see
 * it (after JSON). Used by customers.parity.test.ts and scripts/pg-compare.ts.
 *
 * Differences that mean nothing to a screen are evened out first, and only those:
 * - a field that is missing, null, '' or an empty list / object (MongoDB leaves a
 *   field out where Postgres stores its default);
 * - `__v` (Mongoose's own counter);
 * - Binders '0' (MongoDB's default) and no Binders.
 */
import type { Loose } from '../../types/records.ts';
import { branchZone } from '../../config/branches.ts';
import { contactIdFor } from '../copy/customerRows.ts';
import { toLocalTime } from '../copy/values.ts';

/** Source facts for the few profile conversions; never infer an allowance from SQL output alone. */
export function profileParityContext(customers: Loose[]) {
  const zoneByEntry = new Map<string, string>();
  const customerNameByResource = new Map<string, string>();
  const generatedContactIds = new Set<string>();
  const invalidVisitAuthors = new Map<string, string>();
  for (const c of customers) {
    const zone = branchZone(c.location);
    for (const [position, contact] of (c.contacts || []).entries()) {
      const id = contact._id ? String(contact._id) : contactIdFor(String(c._id), position);
      zoneByEntry.set(id, zone);
      if (!contact._id) generatedContactIds.add(id);
    }
    for (const visit of c.visits || []) {
      zoneByEntry.set(String(visit._id), zone);
      for (const r of visit.reactions || []) zoneByEntry.set(String(r._id), zone);
      if (typeof visit.createdBy === 'string' && visit.createdBy && !/^[a-f0-9]{24}$/i.test(visit.createdBy)) {
        invalidVisitAuthors.set(String(visit._id), visit.createdBy);
      }
    }
    for (const resource of c.resources || []) {
      zoneByEntry.set(String(resource._id), zone);
      customerNameByResource.set(String(resource._id), c.company || c.contactName || '');
    }
  }
  return { zoneByEntry, customerNameByResource, generatedContactIds, invalidVisitAuthors };
}

export interface ParityContext {
  postgres: unknown;
  profiles: ReturnType<typeof profileParityContext>;
}

/** Closest containing record, including a visit around an id-less follow-up event. */
function containingRecord(d: Difference, context?: ParityContext): Loose | undefined {
  if (!context) return undefined;
  let value = context.postgres as Loose;
  let record = value?._id ? value : undefined;
  for (const key of d.path.split('.').slice(0, -1)) {
    value = value?.[key];
    if (value?._id) record = value;
  }
  return record;
}

export function normalize(value: unknown): unknown {
  const v = JSON.parse(JSON.stringify(value ?? null));
  return clean(v);
}

function clean(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      if (k === '__v') continue;
      let x = clean((v as Record<string, unknown>)[k]);
      if (k === 'modaBinder' && x === '0') x = undefined;
      if (isBlank(x)) continue;
      out[k] = x;
    }
    return out;
  }
  return v;
}

const isBlank = (x: unknown) =>
  x === undefined || x === null || x === '' ||
  (Array.isArray(x) && x.length === 0) ||
  (typeof x === 'object' && x !== null && !Array.isArray(x) && Object.keys(x).length === 0);

export interface Difference {
  path: string;
  mongo: unknown;
  postgres: unknown;
}

/** Field-by-field differences between two normalized values, at most `limit`. */
export function diffEntries(a: unknown, b: unknown, limit = 20): Difference[] {
  const out: Difference[] = [];
  const walk = (x: unknown, y: unknown, p: string) => {
    if (out.length >= limit) return;
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    // Lists of ids are compared whole (a missing link reads better than shifted positions).
    const idList = (v: unknown) => Array.isArray(v) && v.every(i => typeof i === 'string' && /^[0-9a-f]{24}$/.test(i));
    if (x && y && typeof x === 'object' && typeof y === 'object' && !(idList(x) && idList(y))) {
      const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
      for (const k of keys) walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], p ? `${p}.${k}` : k);
      return;
    }
    out.push({ path: p || '(value)', mongo: x, postgres: y });
  };
  walk(a, b, '');
  return out;
}

export const describeDifference = (d: Difference) =>
  `${d.path}: mongo ${JSON.stringify(d.mongo)} · postgres ${JSON.stringify(d.postgres)}`;

/** Field-by-field differences as lines, at most `limit`. */
export function differences(a: unknown, b: unknown, limit = 20): string[] {
  return diffEntries(a, b, limit).map(describeDifference);
}

/**
 * Differences between live MongoDB and its Postgres copy that are understood, each with
 * why (src/db/README.md, "Known differences"). Anything not matched here is a bug.
 */
/** A field of a visit or resource: the whole response is that record, or it sits under visits.N / resources.N. */
const entryField = (field: string, kinds: ('visits' | 'resources')[]) => (path: string) =>
  path === field || new RegExp(`(^|\\.)(${kinds.join('|')})\\.\\d+\\.${field}$`).test(path);
const isVisitFollowUpDate = entryField('followUpDate', ['visits']);
const isEntryImage = entryField('image', ['visits', 'resources']);
const isResourceCustomer = entryField('customer', ['resources']);
const isVisitCreatedBy = entryField('createdBy', ['visits']);

export const KNOWN_DIFFERENCES: { why: string; matches: (d: Difference, context?: ParityContext) => boolean }[] = [
  {
    why: 'saved without createdAt / updatedAt in MongoDB; Postgres has the time from its id',
    matches: d => /(^|\.)(createdAt|updatedAt)$/.test(d.path) && d.mongo === undefined && typeof d.postgres === 'string'
  },
  {
    why: 'MongoDB\'s stored copy of the rep\'s name is out of date; Postgres reads the user\'s name now',
    matches: d => /(^|\.)salesRepName$/.test(d.path) && typeof d.mongo === 'string' && typeof d.postgres === 'string'
  },
  {
    why: 'old customer with no geocode block; Postgres stores the default "pending"',
    matches: d => /(^|\.)geocode$/.test(d.path) && d.mongo === undefined && JSON.stringify(d.postgres) === '{"status":"pending"}'
  },
  {
    why: 'a field no screen reads, not copied (firstName / lastName on 2 old records, lastLoginIp)',
    matches: d => /(^|\.)(firstName|lastName|lastLoginIp)$/.test(d.path) && d.postgres === undefined
  },
  {
    why: 'a link to a deleted customer, which the copy leaves out',
    matches: d => /(^|\.)(associatedCustomers|notDuplicateOf)$/.test(d.path) && Array.isArray(d.mongo) &&
      ((d.postgres === undefined) || (Array.isArray(d.postgres) && d.postgres.every(id => (d.mongo as unknown[]).includes(id))))
  },
  {
    why: 'legacy history clock converted by the copy, on its source branch (or its own Date.toString clock)',
    matches: (d, context) => {
      if (!/(^|\.)(createdAt|updatedAt|followUpDoneAt|at)$/.test(d.path) || typeof d.mongo !== 'string' || typeof d.postgres !== 'string') return false;
      const zone = context?.profiles.zoneByEntry.get(String(containingRecord(d, context)?._id));
      if (!zone) return false;
      const converted = toLocalTime(d.mongo, zone);
      return converted.ok && converted.value?.replace(' ', 'T') === d.postgres;
    }
  },
  {
    why: 'old follow-up day saved as midnight UTC, copied as the same calendar day',
    matches: d => isVisitFollowUpDate(d.path) && typeof d.mongo === 'string' &&
      /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(d.mongo) && d.postgres === d.mongo.slice(0, 10)
  },
  {
    why: 'legacy single photo URL, copied as a one-element attachment array with the same URL',
    matches: d => isEntryImage(d.path) && typeof d.mongo === 'string' &&
      Array.isArray(d.postgres) && d.postgres.length === 1 && d.postgres[0] === d.mongo
  },
  {
    why: 'resource customer name is the current parent name, rather than an old stored copy',
    matches: (d, context) => isResourceCustomer(d.path) && typeof d.postgres === 'string' &&
      context?.profiles.customerNameByResource.get(String(containingRecord(d, context)?._id)) === d.postgres
  },
  {
    why: 'a legacy visit author is not an account id, blanked by the copy (the author name stays)',
    matches: (d, context) => isVisitCreatedBy(d.path) && d.postgres === undefined && typeof d.mongo === 'string' &&
      context?.profiles.invalidVisitAuthors.get(String(containingRecord(d, context)?._id)) === d.mongo
  },
  {
    why: 'a contact without an id gets the copy\'s deterministic id',
    matches: (d, context) => /(^|\.)contacts\.\d+\._id$/.test(d.path) && d.mongo === undefined && typeof d.postgres === 'string' &&
      context?.profiles.generatedContactIds.has(d.postgres) === true
  },
  {
    why: 'a legacy contact explicitly stored isPrimary=false; the profile omits this unused default',
    matches: d => /(^|\.)contacts\.\d+\.isPrimary$/.test(d.path) && d.mongo === false && d.postgres === undefined
  }
];

export const knownWhy = (d: Difference, context?: ParityContext) => KNOWN_DIFFERENCES.find(k => k.matches(d, context))?.why ?? null;
