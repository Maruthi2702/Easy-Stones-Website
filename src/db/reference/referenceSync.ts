/**
 * Runs syncReference whenever users, roles, locations or the type lists change in MongoDB:
 * once at start-up, on every change (a change stream on those six collections, so a save through
 * a model, a script or the shell all count), and every 10 minutes as a safety net. Only when the
 * customer area is on Postgres (`DB_CUSTOMERS=postgres`); before that the whole-database copy does it.
 */
import type { Db as MongoDb } from 'mongodb';
import { areaOn, appDb } from '../appDb.ts';
import { syncReference, type ReferenceSyncReport } from './syncReference.ts';
import type { ReferenceSource } from '../copy/referenceRows.ts';

export const REFERENCE_COLLECTIONS = { locations: 'locations', roles: 'roles', users: 'users', visitTypes: 'visittypes', resourceFamilies: 'resourcefamilies', resourceTypes: 'resourcetypes' } as const;

export async function readReference(mongo: MongoDb): Promise<ReferenceSource> {
  const entries = await Promise.all(Object.entries(REFERENCE_COLLECTIONS).map(async ([key, name]) => [key, await mongo.collection(name).find({}).toArray()] as const));
  return Object.fromEntries(entries) as unknown as ReferenceSource;
}

export interface ReferenceSyncHandle { stop(): void; syncNow(): Promise<void>; lastReport(): ReferenceSyncReport | null }

export interface ReferenceSyncOptions { retryMs?: number; safetyMs?: number; log?: (m: string) => void }

/** Start keeping Postgres's reference tables current. Returns a handle (stop() on shutdown, syncNow() for tests). */
export function startReferenceSync(mongo: MongoDb, options: ReferenceSyncOptions = {}): ReferenceSyncHandle | null {
  if (areaOn('customers') !== 'postgres') return null;
  const log = options.log ?? ((m: string) => console.log(m));
  let running = false, again = false, stopped = false, last: ReferenceSyncReport | null = null;
  let retry: NodeJS.Timeout | undefined;

  const run = async (): Promise<void> => {
    if (running) { again = true; return; }
    running = true;
    try {
      do {
        again = false;
        last = await syncReference(await appDb(), await readReference(mongo));
        if (last.kept.length) log(`⚠️ Reference sync kept rows Postgres still needs: ${last.kept.join(', ')}`);
      } while (again && !stopped);
    } catch (err) {
      console.error('Reference sync failed (retrying):', (err as Error).message);
      if (!stopped) { clearTimeout(retry); retry = setTimeout(() => void run(), options.retryMs ?? 30_000); retry.unref?.(); }
    } finally {
      running = false;
    }
  };

  let stream: ReturnType<MongoDb['watch']> | undefined;
  const watch = () => {
    if (stopped) return;
    try {
      stream = mongo.watch([{ $match: { 'ns.coll': { $in: Object.values(REFERENCE_COLLECTIONS) } } }]);
      stream.on('change', () => void run());
      stream.on('error', err => { console.error('Reference change stream:', (err as Error).message); setTimeout(watch, 5000).unref?.(); });
    } catch (err) {
      console.error('Reference change stream could not open (the 10-minute sync still runs):', (err as Error).message);
    }
  };
  void run();
  watch();
  const timer = setInterval(() => void run(), options.safetyMs ?? 10 * 60_000);
  timer.unref?.();

  return {
    stop() { stopped = true; clearInterval(timer); clearTimeout(retry); void stream?.close().catch(() => {}); },
    async syncNow() { await run(); while (running) await new Promise(r => setTimeout(r, 10)); },
    lastReport: () => last
  };
}
