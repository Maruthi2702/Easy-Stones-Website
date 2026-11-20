/**
 * Phones that can get push notifications (iOS app, 2026-11-19). Postgres only —
 * new since the cutover. One row per APNs device token: a token belongs to the
 * person signed in on that phone last (a different person registering the same
 * token takes it over). `user_id` has no foreign key, like location_points.
 * `environment` is what Apple answered for it ('' = not learned yet).
 */
import { pgTable, text, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { objectId, moment } from './columns.ts';

export const pushDevices = pgTable('push_devices', {
  id: objectId('id').primaryKey(),
  userId: text('user_id').notNull(),
  token: text('token').notNull(),
  platform: text('platform').notNull().default('ios'),
  environment: text('environment').notNull().default(''),
  createdAt: moment('created_at').notNull().defaultNow(),
  lastSeenAt: moment('last_seen_at').notNull().defaultNow()
}, t => [
  uniqueIndex('push_devices_token_uq').on(t.token),
  index('push_devices_user_idx').on(t.userId)
]);
