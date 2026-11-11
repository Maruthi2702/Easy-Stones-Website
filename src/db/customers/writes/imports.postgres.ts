/**
 * The customer imports' saves on Postgres: the twin of imports.mongo.ts, proved by
 * imports.parity.test.ts. A batch is one transaction; a row Postgres refuses for its
 * data (a held email or SPS name) is rolled back alone (a savepoint) and reported by
 * index, as MongoDB's unordered writes do.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../copy/plan.ts';
import { customers, customerLinks } from '../../schema/customers.ts';
import { locations, users } from '../../schema/reference.ts';
import { importMemories } from '../../schema/misc.ts';
import { customerDoc, type CustomerLinks } from '../customerDoc.ts';
import type { Loose } from '../../../types/records.ts';
import { insertCustomerDoc, customerPatch, isUniqueViolation, violatedConstraint, referenceIndexFromPg } from './customerDocPg.ts';
import type { ConnectInput, ConnectResult, ImportUpdate, MemorySave } from './importsTypes.ts';

/** The customers a plan is judged against, in the shape the API has always sent. */
export async function customersForPlan(db: Db): Promise<Loose[]> {
  const rows = await db.select({ c: customers, locationName: locations.name, repUsername: users.username, repDisplayName: users.displayName })
    .from(customers)
    .leftJoin(locations, eq(locations.id, customers.locationId))
    .leftJoin(users, eq(users.id, customers.salesRepId))
    .orderBy(asc(customers.id));
  const links = await db.select().from(customerLinks).orderBy(asc(customerLinks.customerId), asc(customerLinks.position));
  const byCustomer = new Map<string, CustomerLinks>();
  for (const l of links) {
    const entry = byCustomer.get(l.customerId) ?? { associated: [], notDuplicate: [] };
    (l.kind === 'associated' ? entry.associated : entry.notDuplicate).push(l.otherCustomerId);
    byCustomer.set(l.customerId, entry);
  }
  return rows.map(r => customerDoc(r.c, r, byCustomer.get(r.c.id) ?? { associated: [], notDuplicate: [] }, null));
}

export async function readImportMemory(db: Db): Promise<Loose | null> {
  const [row] = await db.select().from(importMemories).where(eq(importMemories.kind, 'customer'));
  return row ? { repAliases: row.repAliases, branchAliases: row.branchAliases, decisions: row.decisions, updatedBy: row.updatedBy } : null;
}

export async function saveImportMemory(db: Db, { set, by, id }: MemorySave): Promise<void> {
  await db.transaction(async tx => {
    const [row] = await tx.select().from(importMemories).where(eq(importMemories.kind, 'customer'));
    const next = {
      repAliases: { ...(row?.repAliases as Loose ?? {}) },
      branchAliases: { ...(row?.branchAliases as Loose ?? {}) },
      decisions: { ...(row?.decisions as Loose ?? {}) }
    };
    for (const [path, value] of Object.entries(set)) {
      const dot = path.indexOf('.');
      (next[path.slice(0, dot) as keyof typeof next] as Loose)[path.slice(dot + 1)] = value;
    }
    const now = new Date();
    if (row) await tx.update(importMemories).set({ ...next, updatedBy: by, updatedAt: now }).where(eq(importMemories.id, row.id));
    else await tx.insert(importMemories).values({ id, kind: 'customer', ...next, updatedBy: by, createdAt: now, updatedAt: now });
  });
}

export async function forgetImportMemory(db: Db): Promise<void> {
  await db.delete(importMemories).where(eq(importMemories.kind, 'customer'));
}

const reasonFor = (err: unknown) =>
  isUniqueViolation(err) && violatedConstraint(err) === 'customers_sps_key_key'
    ? 'another customer took that SPS name first'
    : (err as Error).message || 'could not be saved';

/** POST /api/customers/sps-connect/apply, the writes. */
export async function connectSps(db: Db, { connect, notInSps, nameByKey, by, now }: ConnectInput): Promise<ConnectResult> {
  const failed: ConnectResult['failed'] = [];
  // Only a customer that holds no SPS name is touched, so a repeat changes nothing twice.
  const connectOne = async (tx: Db, { customerId, key }: { customerId: string; key: string }) =>
    (await tx.update(customers).set({
      spsKey: key, spsName: nameByKey[key], spsFirstImportedAt: now, spsLastSeenAt: now, spsConnectedAt: now, spsConnectedBy: by
    }).where(and(eq(customers.id, customerId), isNull(customers.spsKey))).returning({ id: customers.id })).length;
  const markOne = async (tx: Db, customerId: string) =>
    (await tx.update(customers).set({ spsReviewedAs: 'none', spsConnectedAt: now, spsConnectedBy: by })
      .where(and(eq(customers.id, customerId), isNull(customers.spsKey))).returning({ id: customers.id })).length;

  return db.transaction(async tx => {
    let connected = 0;
    for (const op of connect) {
      try {
        connected += await tx.transaction(s => connectOne(s as unknown as Db, op));
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        failed.push({ customerId: op.customerId, reason: reasonFor(err) });
      }
    }
    let marked = 0;
    for (const id of notInSps) marked += await markOne(tx, id);
    return { connected, notInSps: marked, failed };
  });
}

/** Add the validated documents (`doc.toObject()`, each with its _id), a row at a time in one transaction. */
export async function insertImportedCustomers(db: Db, docs: Loose[]): Promise<Map<number, string>> {
  const failed = new Map<number, string>();
  const now = new Date();
  await db.transaction(async tx => {
    const ref = await referenceIndexFromPg(tx);
    for (const [i, doc] of docs.entries()) {
      try {
        await tx.transaction(async s => {
          if (!(await insertCustomerDoc(s as unknown as Db, { ...doc, createdAt: now, updatedAt: now }, ref))) throw new Error('Could not be saved');
        });
      } catch (err) {
        const e = err as Error;
        failed.set(i, isUniqueViolation(err)
          ? `E11000 duplicate key error collection: customers index: ${violatedConstraint(err) === 'customers_sps_key_key' ? 'sps.key_1' : 'email_1'}`
          : e.message || 'Could not be saved');
      }
    }
  });
  return failed;
}

export async function updateImportedCustomers(db: Db, batch: ImportUpdate[]): Promise<Map<number, string>> {
  const failed = new Map<number, string>();
  await db.transaction(async tx => {
    for (const [i, row] of batch.entries()) {
      try {
        await tx.transaction(async s => {
          const patch = await customerPatch(s as unknown as Db, row.apply);
          await (s as unknown as Db).update(customers).set({ ...patch, updatedAt: new Date() }).where(eq(customers.id, row.targetId));
        });
      } catch (err) {
        failed.set(i, isUniqueViolation(err) ? 'E11000 duplicate key error collection: customers index: email_1' : (err as Error).message || 'Could not be saved');
      }
    }
  });
  return failed;
}

