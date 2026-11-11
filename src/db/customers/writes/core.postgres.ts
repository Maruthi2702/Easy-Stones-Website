/**
 * Customer saves on Postgres. Each writes what the copy would make of the MongoDB
 * record after the same save (src/db/copy/customerRows.ts), and answers what its
 * MongoDB twin in core.mongo.ts answers (core.parity.test.ts proves both).
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../copy/plan.ts';
import { customers } from '../../schema/customers.ts';

/**
 * Mongoose casts a quick note to text; a list or an object is refused (the route
 * answers 500, as it always has). null / undefined store nothing ('' here: the copy's
 * value for a missing note).
 */
function noteText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') throw new Error('Cast to string failed for quickNote');
  return String(value);
}

/** PATCH /api/customers/:id/quick-note. null = no such customer. */
export async function setQuickNote(db: Db, id: string, quickNote: unknown): Promise<{ quickNote: string } | null> {
  const [row] = await db.update(customers)
    .set({ quickNote: noteText(quickNote), updatedAt: new Date() })
    .where(eq(customers.id, id))
    .returning({ quickNote: customers.quickNote });
  return row ?? null;
}
