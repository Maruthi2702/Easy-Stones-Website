/** The expense row counts by kind, on an in-memory Postgres. */
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../schema/index.ts';
import { migrateDb } from '../client.ts';
import type { Db } from '../copy/plan.ts';
import { cardExpenses } from '../schema/cardsSuppliers.ts';
import { rowCounts } from './rowCounts.ts';

const hex = (n: number) => n.toString(16).padStart(24, '0');
let client: PGlite, db: Db;
const expense = (n: number, over: Record<string, unknown> = {}) => ({
  id: hex(n), cardLabel: 'MARU92069', holderName: 'Krish', day: '2026-11-05', month: '2026-11', merchant: 'X', cents: 1000, status: 'waiting', ...over
});

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
  await migrateDb(db, 'pglite:memory');
});
afterEach(async () => { await client.close(); });

describe('rowCounts', () => {
  it('counts receipts, Missing rows and each statement kind with their dollars, and leaves voided rows out', async () => {
    await db.insert(cardExpenses).values([
      expense(1), expense(2, { cents: 500 }), expense(3, { status: 'missing', cents: 300 }),
      expense(4, { statementKind: 'refund', cents: -5400 }), expense(5, { statementKind: 'fee', cents: 2500 }), expense(6, { statementKind: 'fee', cents: 2500 }),
      expense(7, { statementKind: 'refunded_charge', cents: 5400 }), expense(8, { voidedAt: new Date(), cents: 99999 })
    ]);
    expect(await rowCounts(db)).toEqual({
      receipt: { n: 2, cents: 1500 }, 'missing receipt': { n: 1, cents: 300 },
      refund: { n: 1, cents: -5400 }, fee: { n: 2, cents: 5000 }, refunded_charge: { n: 1, cents: 5400 }
    });
  });
  it('is empty on an empty table', async () => {
    expect(await rowCounts(db)).toEqual({});
  });
});
