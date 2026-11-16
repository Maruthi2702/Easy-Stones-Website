/**
 * The small part of MongoDB's query language the staff screens use, run on documents already
 * in memory. Users, roles and locations are a few dozen rows, so the Postgres side reads them
 * whole (as MongoDB-shaped documents) and answers the same filter, projection, sort and update
 * the routes used to hand to Mongoose. `sift` is the matcher Mongoose's own tooling uses.
 */
import sift from 'sift';
import type { Loose } from '../../types/records.ts';

/** An ObjectId (anything with toHexString) → its 24 characters, deep in a filter. */
export function plainIds(value: unknown): unknown {
  if (value && typeof value === 'object') {
    if (value instanceof RegExp || value instanceof Date) return value;
    if (typeof (value as Loose).toHexString === 'function') return (value as Loose).toHexString();
    if (Array.isArray(value)) return value.map(plainIds);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plainIds(v)]));
  }
  return value;
}

export const matches = (doc: Loose, filter?: Loose | null): boolean =>
  !filter || Object.keys(filter).length === 0 || sift(plainIds(filter) as Loose)(doc);

/**
 * Mongoose's select string: 'a b' keeps only those (+ _id), '-a' drops one, '+a' brings back a
 * field that is hidden by default (`secrets`).
 */
export function selectFields(doc: Loose, select: string | undefined, secrets: string[] = []): Loose {
  const tokens = String(select ?? '').split(/\s+/).filter(Boolean);
  const plus = tokens.filter(t => t.startsWith('+')).map(t => t.slice(1));
  const minus = tokens.filter(t => t.startsWith('-')).map(t => t.slice(1));
  const only = tokens.filter(t => !/^[+-]/.test(t));
  if (only.length) {
    const out: Loose = { _id: doc._id };
    for (const k of [...only, ...plus]) if (doc[k] !== undefined) out[k] = doc[k];
    return out;
  }
  const out: Loose = { ...doc };
  for (const k of secrets) if (!plus.includes(k)) delete out[k];
  for (const k of minus) delete out[k];
  return out;
}

/** MongoDB's default order: values compared as they are (strings by code point). */
export function sortDocs<T extends Loose>(docs: T[], sort?: Record<string, 1 | -1>): T[] {
  const keys = Object.entries(sort ?? {});
  if (!keys.length) return docs;
  const key = (v: unknown) => (v instanceof Date ? v.getTime() : v);
  return [...docs].sort((a, b) => {
    for (const [k, dir] of keys) {
      const x = key(a[k]); const y = key(b[k]);
      if (x === y) continue;
      if (x == null) return -dir;
      if (y == null) return dir;
      return (x < y ? -1 : 1) * dir;
    }
    return 0;
  });
}

const setPath = (doc: Loose, path: string, value: unknown): Loose => {
  const [head, ...rest] = path.split('.');
  if (!rest.length) return { ...doc, [head!]: value };
  const inner = doc[head!] && typeof doc[head!] === 'object' && !Array.isArray(doc[head!]) ? doc[head!] : {};
  return { ...doc, [head!]: setPath(inner, rest.join('.'), value) };
};
const unsetPath = (doc: Loose, path: string): Loose => {
  const [head, ...rest] = path.split('.');
  if (!rest.length) { const { [head!]: _gone, ...others } = doc; return others; }
  if (!doc[head!] || typeof doc[head!] !== 'object') return doc;
  return { ...doc, [head!]: unsetPath(doc[head!], rest.join('.')) };
};
const getPath = (doc: Loose, path: string): unknown => path.split('.').reduce<unknown>((v, k) => (v as Loose | undefined)?.[k], doc);

/** $set, $unset and $inc on a copy of the document; a path may be dotted (`routePlannerFilters.reps`). */
export function applyUpdate(doc: Loose, update: Loose): Loose {
  let out: Loose = { ...doc };
  for (const [k, v] of Object.entries(update.$set ?? {})) out = setPath(out, k, v);
  for (const k of Object.keys(update.$unset ?? {})) out = unsetPath(out, k);
  for (const [k, v] of Object.entries(update.$inc ?? {})) out = setPath(out, k, (Number(getPath(out, k)) || 0) + Number(v));
  return out;
}
