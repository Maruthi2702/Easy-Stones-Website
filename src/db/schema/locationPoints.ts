/**
 * Where the people who are tracked have been (iOS app, 2026-11-19; rules in
 * src/utils/locationTracking.ts). Postgres only — new since the cutover, no
 * MongoDB copy. One row per point the phone sent, kept 90 days. `user_id` has no
 * foreign key on purpose: a deactivated or removed person's trail ages out on its
 * own rather than blocking their deletion. `client_id` is the phone's own id for
 * the point, so a batch sent twice saves nothing twice.
 */
import { pgTable, text, real, integer, doublePrecision, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { objectId, moment } from './columns.ts';

export const locationPoints = pgTable('location_points', {
  id: objectId('id').primaryKey(),
  userId: text('user_id').notNull(),
  /** The branch whose clock the 7–6 window was read on, as the person worked when it was recorded. */
  branch: text('branch').notNull().default(''),
  clientId: text('client_id').notNull(),
  recordedAt: moment('recorded_at').notNull(),
  receivedAt: moment('received_at').notNull().defaultNow(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  accuracyM: real('accuracy_m'),
  speedMps: real('speed_mps')
}, t => [
  uniqueIndex('location_points_user_client_uq').on(t.userId, t.clientId),
  index('location_points_user_time_idx').on(t.userId, t.recordedAt),
  index('location_points_time_idx').on(t.recordedAt)
]);

/**
 * Who agreed to be tracked, when, and to which wording (CONSENT_VERSION in
 * src/utils/locationTracking.ts). One row per person per version, never changed
 * or deleted with the points: it is the record that they were told. The server
 * refuses a person's points until their row for the current version exists.
 */
export const locationConsents = pgTable('location_consents', {
  id: objectId('id').primaryKey(),
  userId: text('user_id').notNull(),
  version: integer('version').notNull(),
  consentedAt: moment('consented_at').notNull().defaultNow(),
  /** The phone's user agent when they tapped Allow (shortened). */
  device: text('device').notNull().default('')
}, t => [uniqueIndex('location_consents_user_version_uq').on(t.userId, t.version)]);
