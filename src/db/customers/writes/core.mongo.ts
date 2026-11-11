/**
 * Customer saves on MongoDB: the routes' own code, moved here unchanged.
 * Its Postgres twin is core.postgres.ts; pick between them through core.ts.
 */
import Customer from '../../../models/Customer.ts';

/** PATCH /api/customers/:id/quick-note. null = no such customer. */
export async function setQuickNote(id: string, quickNote: unknown): Promise<{ quickNote: string } | null> {
  const customer = await Customer.findByIdAndUpdate(id, { quickNote }, { new: true });
  return customer ? { quickNote: customer.quickNote } : null;
}
