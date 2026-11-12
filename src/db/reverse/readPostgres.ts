/** Read every table the reverse copy needs out of Postgres (reads only). */
import type { Db } from '../copy/plan.ts';
import * as S from '../schema/index.ts';
import type { ReverseSource } from './docs.ts';

export async function readPostgres(db: Db): Promise<ReverseSource> {
  return {
    locations: await db.select().from(S.locations),
    users: await db.select().from(S.users),
    customers: await db.select().from(S.customers).orderBy(S.customers.matchOrder),
    customerLogins: await db.select().from(S.customerLogins),
    customerContacts: await db.select().from(S.customerContacts),
    customerLinks: await db.select().from(S.customerLinks),
    visits: await db.select().from(S.visits),
    visitAttachments: await db.select().from(S.visitAttachments),
    visitReactions: await db.select().from(S.visitReactions),
    visitFollowUpEvents: await db.select().from(S.visitFollowUpEvents),
    resources: await db.select().from(S.resources),
    resourceAttachments: await db.select().from(S.resourceAttachments),
    schedules: await db.select().from(S.schedules),
    activityLogs: await db.select().from(S.activityLogs),
    customerDeleteBackups: await db.select().from(S.customerDeleteBackups),
    customerMergeBackups: await db.select().from(S.customerMergeBackups),
    importMemories: await db.select().from(S.importMemories),
    spsImportRuns: await db.select().from(S.spsImportRuns),
    spsImportItems: await db.select().from(S.spsImportItems)
  } as ReverseSource;
}
