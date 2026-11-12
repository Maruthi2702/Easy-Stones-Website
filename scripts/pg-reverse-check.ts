/**
 * Did the reverse copy rebuild what MongoDB holds? (src/db/reverse/README.md)
 *
 *   MONGO_URI=<live uri> REVERSED_DB=reverse_test node scripts/pg-reverse-check.ts
 *
 * Reads two databases on one MongoDB server, writes nothing: the live one (MONGO_URI's own database) and the
 * scratch one `pg-reverse.ts --apply` filled (REVERSED_DB). Matches documents by _id and prints, per collection,
 * how many are missing, extra or different, then the kinds of difference with an example each. Expect the
 * spellings listed in the reverse README, plus whatever staff changed since the Postgres copy was taken.
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGO_URI, scratch = process.env.REVERSED_DB;
if (!uri || !scratch) { console.error('MONGO_URI and REVERSED_DB are both needed.'); process.exit(1); }
const client = new MongoClient(uri, { readPreference: 'secondaryPreferred', appName: 'pg-reverse-check' });
await client.connect();
const live = client.db(), rev = client.db(scratch);
if (live.databaseName === rev.databaseName) { console.error('REVERSED_DB must be a different database.'); process.exit(1); }

const COLLECTIONS = ['customers', 'schedules', 'activitylogs', 'customerdeletebackups', 'customermergebackups', 'importmemories', 'spsimportruns', 'spsimportitems'];
type V = unknown;
const isEmpty = (x: V) => x == null || x === '' || (Array.isArray(x) && !x.length) || (typeof x === 'object' && !(x instanceof Date) && !(x as { _bsontype?: string })._bsontype && !Array.isArray(x) && !Object.keys(x as object).length);
/** Compare as the screens read it: ids and dates as text, empty = missing, __v ignored. */
function norm(v: V): V {
  if (v == null) return undefined;
  const b = (v as { _bsontype?: string })._bsontype;
  if (b === 'ObjectId') return (v as { toHexString(): string }).toHexString();
  if (b === 'Binary') return `binary:${(v as { length(): number }).length()}`;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) { const a = v.map(norm); return a.length ? a : undefined; }
  if (typeof v === 'object') {
    const o: Record<string, V> = {};
    for (const [k, x] of Object.entries(v as object)) { if (k === '__v') continue; const n = norm(x); if (!isEmpty(n)) o[k] = n; }
    return Object.keys(o).length ? o : undefined;
  }
  return v === '' ? undefined : v;
}
const tally = new Map<string, { n: number; example: string }>();
function walk(a: V, b: V, path: string, id: string, col: string) {
  if (a === b) return;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) walk((a as Record<string, V>)[k], (b as Record<string, V>)[k], `${path}/${Array.isArray(a) ? '[]' : k}`, id, col);
    return;
  }
  const key = `${col} ${path}`;
  const t = tally.get(key) ?? { n: 0, example: `${id}: live=${JSON.stringify(a)?.slice(0, 60)} rebuilt=${JSON.stringify(b)?.slice(0, 60)}` };
  t.n++; tally.set(key, t);
}

console.log(`Comparing ${live.databaseName} (live, read only) with ${rev.databaseName} (rebuilt from Postgres)\n`);
console.log('collection                 live   rebuilt  not rebuilt  differing');
let problems = 0;
for (const col of COLLECTIONS) {
  const [a, b] = await Promise.all([live.collection(col).find({}).toArray(), rev.collection(col).find({}).toArray()]);
  const byId = new Map(b.map(d => [String(d._id), d]));
  let missing = 0, differing = 0;
  for (const d of a) {
    const r = byId.get(String(d._id));
    if (!r) { missing++; continue; }
    const before = tally.size; const sum = [...tally.values()].reduce((s, t) => s + t.n, 0);
    walk(norm(d), norm(r), '', String(d._id), col);
    if ([...tally.values()].reduce((s, t) => s + t.n, 0) !== sum || tally.size !== before) differing++;
  }
  problems += missing;
  console.log(`${col.padEnd(26)} ${String(a.length).padStart(5)} ${String(b.length).padStart(8)} ${String(missing).padStart(12)} ${String(differing).padStart(10)}`);
}
console.log('\nKinds of difference (count, one example):');
for (const [k, t] of [...tally].sort((x, y) => y[1].n - x[1].n).slice(0, 40)) console.log(`${String(t.n).padStart(6)}  ${k}\n          ${t.example}`);
console.log(problems ? `\n${problems} live documents were NOT rebuilt.` : '\nEvery live document was rebuilt.');
await client.close();
