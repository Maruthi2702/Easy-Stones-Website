/**
 * App settings on Postgres. A save builds the document as MongoDB would hold it (key trimmed,
 * `updatedBy` text, the two stamps) and makes the row with the copy's own builder
 * (`appSettingRowOf`), so it writes what a re-copy of MongoDB would.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { appSettings } from '../schema/misc.ts';
import { appSettingRowOf } from '../copy/miscRows.ts';

export async function readSetting(db: Db, key: string): Promise<unknown> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key.trim()));
  return row ? (row.value ?? null) : undefined;
}

/** Upsert on the key: a second save changes the value and the editor, never the id or when it began. */
export async function writeSetting(db: Db, key: string, value: unknown, by: string, id: string): Promise<void> {
  const now = new Date();
  const row = appSettingRowOf({ _id: id, key: key.trim(), value, updatedBy: by, createdAt: now, updatedAt: now }, []);
  if (!row) throw new Error('That setting can’t be stored: it has no id.');
  const { id: _id, createdAt: _created, ...columns } = row;
  await db.insert(appSettings).values(row).onConflictDoUpdate({ target: appSettings.key, set: columns });
}

export async function removeSetting(db: Db, key: string): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.key, key.trim()));
}
