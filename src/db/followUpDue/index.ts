/** How many follow-ups a person has due on a day and not ticked done (Postgres; the morning push, src/jobs/followUpPush.ts). */
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { appDb } from '../appDb.ts';
import { visits } from '../schema/customers.ts';

export async function dueOnDay(userId: string, day: string, db?: Db): Promise<number> {
  const d = db ?? await appDb();
  const [row] = await d.select({ n: count() }).from(visits).where(and(
    eq(visits.createdById, userId),
    eq(sql<string>`${visits.followUpDate}::text`, day),
    isNull(visits.followUpDoneAt)
  ));
  return Number(row?.n ?? 0);
}
