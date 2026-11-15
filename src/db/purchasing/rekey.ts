/**
 * The sales import re-keys Purchasing scopes that pointed at a report's old (legacy) id. On Postgres it
 * runs inside the sales replacement's own transaction, so the two commit or fail together.
 */
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { purchasingScopes } from '../schema/purchasing.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export async function rekeyScopeCohorts(tx: Tx, legacyId: string, id: string): Promise<void> {
  await tx.update(purchasingScopes)
    .set({ cohortId: id, version: sql`${purchasingScopes.version} + 1`, updatedAt: new Date() })
    .where(eq(purchasingScopes.cohortId, legacyId));
}
