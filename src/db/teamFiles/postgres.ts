/**
 * Team Files on Postgres, answering in MongoDB's shape. A save builds the record as Mongoose would hold it (same defaults,
 * trimming and checks), then makes its row with the copy's own builder (teamFileRowOf), so it writes what a re-copy would.
 * `createdAt` was saved as text with no zone (the branch's wall clock); the row keeps it as a time read as UTC, and the
 * record gives the same text back.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { teamFiles } from '../schema/misc.ts';
import { users } from '../schema/reference.ts';
import { teamFileRowOf } from '../copy/miscRows.ts';
import { isId } from '../ids.ts';
import type { Loose } from '../../types/records.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Row = typeof teamFiles.$inferSelect;

const wall = (d: Date) => d.toISOString().replace(/Z$/, '');
const orUndef = <T>(v: T | null): T | undefined => (v == null ? undefined : v);

/** What Mongoose does with a bad id: the route answers 500 either way. */
function castId(id: unknown): string {
  if (!isId(id)) throw new Error(`Cast to ObjectId failed for value "${String(id)}"`);
  return String(id).toLowerCase();
}

function docOf(r: Row, who: Map<string, string>, withContent: boolean): Loose {
  const uploader = r.uploadedBy ? (who.has(r.uploadedBy) ? { _id: r.uploadedBy, username: who.get(r.uploadedBy) } : null) : undefined;
  return {
    _id: r.id, name: r.name, type: r.type, ...(withContent ? { content: r.content } : {}), thumbnail: r.thumbnail,
    contentType: r.contentType, isFolder: r.isFolder, parentId: r.parentId ?? null, uploadedBy: uploader,
    size: orUndef(r.size), pinned: r.pinned, pinnedAt: orUndef(r.pinnedAt), pinnedBy: orUndef(r.pinnedBy), updatedBy: orUndef(r.updatedBy),
    updatedAt: orUndef(r.updatedAt), createdAt: wall(r.createdAt), __v: 0
  };
}
/** The saved record with `uploadedBy` still an id, as `save()` returns it. */
const bare = (r: Row): Loose => ({ ...docOf(r, new Map(), true), uploadedBy: orUndef(r.uploadedBy) });

async function usernames(db: Db | Tx, rows: Row[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map(r => r.uploadedBy).filter((x): x is string => !!x))];
  if (!ids.length) return new Map();
  return new Map((await (db as Db).select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, ids))).map(u => [u.id, u.username]));
}

export async function list(db: Db, parentId: string | null): Promise<Loose[]> {
  const where = parentId ? eq(teamFiles.parentId, castId(parentId)) : isNull(teamFiles.parentId);
  const rows = await db.select().from(teamFiles).where(where).orderBy(desc(teamFiles.isFolder), desc(teamFiles.createdAt), desc(teamFiles.id));
  const who = await usernames(db, rows);
  return rows.map(r => docOf(r, who, false));
}

export async function get(db: Db, id: string): Promise<Loose | null> {
  const [r] = await db.select().from(teamFiles).where(eq(teamFiles.id, castId(id)));
  return r ? docOf(r, await usernames(db, [r]), true) : null;
}

/** The checks Mongoose's schema makes on a save: a name, and content unless it's a folder. */
function checked(doc: Loose): Loose {
  const out = { ...doc };
  if (typeof out.name === 'string') out.name = out.name.trim();
  const problems: string[] = [];
  if (!out.name) problems.push('name: Path `name` is required.');
  if (!out.isFolder && !out.content) problems.push('content: Path `content` is required.');
  if (!out.type) problems.push('type: Path `type` is required.');
  if (problems.length) throw new Error(`SalesDashboardResource validation failed: ${problems.join(', ')}`);
  return out;
}

export async function create(db: Db, fields: Loose, _id: string): Promise<Loose> {
  const doc = checked({ type: 'file', content: '', thumbnail: '', contentType: 'application/octet-stream', isFolder: false, parentId: null, pinned: false, ...fields, _id });
  if (doc.parentId) doc.parentId = castId(doc.parentId);
  if (doc.uploadedBy) doc.uploadedBy = castId(doc.uploadedBy);
  const row = teamFileRowOf(doc, []);
  if (!row) throw new Error('That item can’t be stored: it has no id.');
  await db.insert(teamFiles).values(row);
  const [saved] = await db.select().from(teamFiles).where(eq(teamFiles.id, _id));
  return docOf(saved, await usernames(db, [saved]), true);
}

export async function update(db: Db, id: string, patch: Loose): Promise<Loose | null> {
  return db.transaction(async tx => {
    const [found] = await tx.select().from(teamFiles).where(eq(teamFiles.id, castId(id))).for('update');
    if (!found) return null;
    const next = { ...patch };
    if (next.parentId) next.parentId = castId(next.parentId);
    if (next.uploadedBy) next.uploadedBy = castId(next.uploadedBy);
    // Rebuild the row from the record as it stands plus the change; the text createdAt goes back in as it was written.
    const doc = checked({ ...bare(found), ...next });
    const row = teamFileRowOf(doc, []);
    if (!row) throw new Error('That item can’t be stored: it has no id.');
    const { id: _id, createdAt: _created, ...columns } = row;
    await tx.update(teamFiles).set(columns).where(eq(teamFiles.id, found.id));
    const [saved] = await tx.select().from(teamFiles).where(eq(teamFiles.id, found.id));
    return bare(saved);
  });
}

export async function removeTree(db: Db, id: string): Promise<string[]> {
  return db.transaction(async tx => {
    const [item] = await tx.select().from(teamFiles).where(eq(teamFiles.id, castId(id))).for('update');
    if (!item) return [];
    const doomed: Row[] = [item];
    const seen = new Set([item.id]);
    let frontier = item.isFolder ? [item.id] : [];
    while (frontier.length) {
      const children = await tx.select().from(teamFiles).where(inArray(teamFiles.parentId, frontier));
      frontier = [];
      for (const c of children) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        doomed.push(c);
        if (c.isFolder) frontier.push(c.id);
      }
    }
    await tx.delete(teamFiles).where(inArray(teamFiles.id, doomed.map(d => d.id)));
    return doomed.filter(d => !d.isFolder && d.content).map(d => d.content);
  });
}
