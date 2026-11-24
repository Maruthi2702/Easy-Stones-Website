/** Request counters shared by every server instance (src/db/schema/rateLimits.ts). */
import { eq, lt, sql } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { appDb } from '../appDb.ts';
import { rateLimitHits as hitsTable } from '../schema/rateLimits.ts';

/** Counts one request for `key`: adds to its window, or starts a new window of `windowMs` once the old one has ended. One atomic statement. */
export async function hit(key: string, windowMs: number, db?: Db): Promise<{ hits: number; resetsAt: Date }> {
  const d = db ?? await appDb();
  const fresh = new Date(Date.now() + windowMs);
  const ended = sql`${hitsTable.resetsAt} <= now()`;
  const [row] = await d.insert(hitsTable).values({ key, hits: 1, resetsAt: fresh })
    .onConflictDoUpdate({
      target: hitsTable.key,
      set: {
        hits: sql`case when ${ended} then 1 else ${hitsTable.hits} + 1 end`,
        resetsAt: sql`case when ${ended} then ${fresh.toISOString()}::timestamptz else ${hitsTable.resetsAt} end`
      }
    })
    .returning({ hits: hitsTable.hits, resetsAt: hitsTable.resetsAt });
  // Old rows are only clutter: sweep now and then, not on every request.
  if (Math.random() < 0.02) await prune(d).catch(() => {});
  return row;
}

/** Takes one back (a request the limiter counted but the app then declined to count). */
export async function giveBack(key: string, db?: Db): Promise<void> {
  const d = db ?? await appDb();
  await d.update(hitsTable).set({ hits: sql`greatest(${hitsTable.hits} - 1, 0)` }).where(eq(hitsTable.key, key));
}

export async function reset(key: string, db?: Db): Promise<void> {
  const d = db ?? await appDb();
  await d.delete(hitsTable).where(eq(hitsTable.key, key));
}

/** Deletes counters whose window ended over an hour ago. */
export async function prune(db?: Db): Promise<void> {
  const d = db ?? await appDb();
  await d.delete(hitsTable).where(lt(hitsTable.resetsAt, new Date(Date.now() - 60 * 60 * 1000)));
}
