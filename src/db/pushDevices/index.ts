/** Push devices (Postgres only; see src/db/schema/pushDevices.ts and src/services/apns.ts). */
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { appDb } from '../appDb.ts';
import { newId } from '../ids.ts';
import { pushDevices as devices } from '../schema/pushDevices.ts';

export type PushPlatform = 'ios' | 'android';
export type PushDevice = { id: string; userId: string; token: string; environment: string; platform: string };

/** Saves a phone's token for a person; a token already saved moves to them and its environment is forgotten. `platform` is 'ios' (Apple's token) unless the Android app says otherwise. */
export async function saveDevice(userId: string, token: string, platform: PushPlatform = 'ios', db?: Db): Promise<void> {
  const d = db ?? await appDb();
  await d.insert(devices).values({ id: newId(), userId, token, platform })
    .onConflictDoUpdate({ target: devices.token, set: { userId, platform, environment: '', lastSeenAt: new Date() } });
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
  return d.select({ id: devices.id, userId: devices.userId, token: devices.token, environment: devices.environment, platform: devices.platform })
    .from(devices).where(inArray(devices.userId, userIds));
}

export async function setEnvironment(token: string, environment: 'production' | 'sandbox', db?: Db): Promise<void> {
  const d = db ?? await appDb();
  await d.update(devices).set({ environment }).where(eq(devices.token, token));
}

/** Everyone with at least one registered phone (the morning follow-up push only looks at these). */
export async function usersWithDevices(db?: Db): Promise<string[]> {
  const d = db ?? await appDb();
  const rows = await d.selectDistinct({ userId: devices.userId }).from(devices);
  return rows.map(r => r.userId);
}
