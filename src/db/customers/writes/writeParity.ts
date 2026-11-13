/**
 * Test helper (tests only): proves a customer-area SAVE leaves MongoDB and Postgres
 * holding the same thing.
 *
 *   const t = await openWriteParity(async db => { …seed MongoDB… });
 *   const { mongo, postgres } = await t.both(() => data.setQuickNote(id, 'Gate 12'));
 *   expect(normalize(postgres)).toEqual(normalize(mongo));   // the same answer
 *   expect(await t.differences()).toEqual([]);               // the same data, every table
 *
 * How: the seed goes into an in-memory MongoDB and is copied into PGlite exactly as the
 * real copy does. `both` runs the save once with the area on MongoDB and once on
 * Postgres, at the same frozen clock (so updatedAt and the like match). `differences`
 * re-reads MongoDB and runs the copy's own check (`verifyCopy`) against Postgres: every
 * table, row and column must be what the copy would make of MongoDB now. So the copy's
 * row builders (src/db/copy/*Rows.ts) are the spec for what a Postgres save must write.
 *
 * New ids: make them in the test (or the route) with newId() and pass them to the save,
 * so both databases get the same id.
 */
import { vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db as MongoDb } from 'mongodb';
import { openDb, migrateDb, type OpenDb } from '../../client.ts';
import { copyFromMongo, verifyCopy } from '../../copy/plan.ts';
import { readMongo } from '../../copy/readMongo.ts';
import { useAppDbForTests } from '../../appDb.ts';

export interface WriteParity {
  /** The in-memory MongoDB's URI (mongoose is connected to it). */
  uri: string;
  pg: OpenDb;
  /** Run a save on MongoDB, then on Postgres, at the same moment. */
  both<T>(run: () => Promise<T>, at?: Date): Promise<{ mongo: T; postgres: T }>;
  /** Run something on one database only (e.g. a read to look at the result). */
  on<T>(database: 'mongo' | 'postgres', run: () => Promise<T>): Promise<T>;
  /** What Postgres holds that the copy of MongoDB wouldn't: [] = the same. */
  differences(): Promise<string[]>;
  /** Copy MongoDB into Postgres again (after a test that left them apart on purpose). */
  resync(): Promise<void>;
  close(): Promise<void>;
}

/** `area` is the switch the test flips: DB_CUSTOMERS unless another area's test says so (DB_DELIVERIES…). */
export async function openWriteParity(seed: (db: MongoDb) => Promise<void>, AREA = 'DB_CUSTOMERS'): Promise<WriteParity> {
  const prior = process.env[AREA];
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = rs.getUri();
  await mongoose.connect(uri);
  await seed(mongoose.connection.db!);
  const pg = await openDb('pglite:memory');
  await migrateDb(pg.db, 'pglite:memory');
  const resync = async () => { await copyFromMongo(pg.db, await readMongo(uri, 'write-parity'), { write: true }); };
  await resync();
  useAppDbForTests(pg.db);

  const on = async <T>(database: 'mongo' | 'postgres', run: () => Promise<T>) => {
    process.env[AREA] = database === 'postgres' ? 'postgres' : '';
    try { return await run(); } finally { process.env[AREA] = prior ?? ''; }
  };

  return {
    uri, pg, on, resync,
    async both(run, at = new Date('2026-11-10T17:30:00.000Z')) {
      // Only Date is faked: the drivers' own timers keep running.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(at);
      try {
        const mongo = await on('mongo', run);
        vi.setSystemTime(at);
        const postgres = await on('postgres', run);
        return { mongo, postgres };
      } finally {
        vi.useRealTimers();
      }
    },
    async differences() {
      return verifyCopy(pg.db, await readMongo(uri, 'write-parity'));
    },
    async close() {
      useAppDbForTests(null);
      if (prior === undefined) delete process.env[AREA]; else process.env[AREA] = prior;
      await mongoose.disconnect();
      await pg.close();
      await rs.stop();
    }
  };
}
