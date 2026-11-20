/** Push devices (Postgres only; see src/db/schema/pushDevices.ts and src/services/apns.ts). */
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { appDb } from '../appDb.ts';
import { newId } from '../ids.ts';
import { pushDevices as devices } from '../schema/pushDevices.ts';

export type PushDevice = { id: string; userId: string; token: string; environment: string };

/** Saves a phone's token for a person; a token already saved moves to them and its environment is forgotten. */
export async function saveDevice(userId: string, token: string, db?: Db): Promise<void> {
  const d = db ?? await appDb();
  await d.insert(devices).values({ id: newId(), userId, token })
    .onConflictDoUpdate({ target: devices.token, set: { userId, environment: '', lastSeenAt: new Date() } });
}

export async function removeToken(token: string, userId: string | null, db?: Db): Promise<void> {
  const d = db ?? await appDb();
  const rows = await d.select({ id: devices.id, userId: devices.userId }).from(devices).where(eq(devices.token, token));
  const mine = rows.filter(r => userId === null || r.userId === userId).map(r => r.id);
  if (mine.length) await d.delete(devices).where(inArray(devices.id, mine));
}

export async function removeTokens(tokens: string[], db?: Db): Promise<void> {
  if (!tokens.length) return;
  const d = db ?? await appDb();
  await d.delete(devices).where(inArray(devices.token, tokens));
}

export async function devicesFor(userIds: string[], db?: Db): Promise<PushDevice[]> {
  if (!userIds.length) return [];
  const d = db ?? await appDb();
  return d.select({ id: devices.id, userId: devices.userId, token: devices.token, environment: devices.environment })
    .from(devices).where(inArray(devices.userId, userIds));
}

export async function setEnvironment(token: string, environment: 'production' | 'sandbox', db?: Db): Promise<void> {
  const d = db ?? await appDb();
  await d.update(devices).set({ environment }).where(eq(devices.token, token));
}
