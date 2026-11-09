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
export const KNOWN_DIFFERENCES: { why: string; matches: (d: Difference) => boolean }[] = [
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
  }
];

export const knownWhy = (d: Difference) => KNOWN_DIFFERENCES.find(k => k.matches(d))?.why ?? null;
