/**
 * Where the people who are tracked have been (iOS app, 2026-11-19; rules in
 * src/utils/locationTracking.ts). Postgres only — new since the cutover, no
 * MongoDB copy. One row per point the phone sent, kept 90 days. `user_id` has no
 * foreign key on purpose: a deactivated or removed person's trail ages out on its
 * own rather than blocking their deletion. `client_id` is the phone's own id for
 * the point, so a batch sent twice saves nothing twice.
 */
import { pgTable, text, real, integer, boolean, doublePrecision, index, uniqueIndex } from 'drizzle-orm/pg-core';
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

/**
 * "Locate now" requests (2026-11-20; rules in src/utils/locationRequests.ts): an admin asked one
 * person's phone for a single position outside the 7–6 window. The answer is kept HERE, never in
 * `location_points`, so the window rule for ordinary points is untouched. Every ask is a row, with
 * who asked and why; kept 90 days. No foreign keys, like the points: people can be removed.
 */
export const locationRequests = pgTable('location_requests', {
  id: objectId('id').primaryKey(),
  /** The person whose phone is asked. */
  targetUserId: text('target_user_id').notNull(),
  requestedBy: text('requested_by').notNull(),
  requestedByName: text('requested_by_name').notNull().default(''),
  reason: text('reason').notNull(),
  requestedAt: moment('requested_at').notNull().defaultNow(),
  answeredAt: moment('answered_at'),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  accuracyM: real('accuracy_m'),
  /** The wording version the person had agreed to when asked. */
  consentVersion: integer('consent_version').notNull().default(0)
}, t => [
  index('location_requests_target_time_idx').on(t.targetUserId, t.requestedAt),
  index('location_requests_time_idx').on(t.requestedAt)
]);

/**
 * Each tracked person's newest point, one row per person (2026-11-22, location v2). The manager's live
 * view reads THIS, so a poll is at most one row per person instead of a DISTINCT ON over millions of
 * points. Written in the same transaction as the points, and only when the new point is newer than the
 * row (a backlog arriving late never moves someone back). `updated_at` is the cursor the live poll uses.
 */
export const locationLatest = pgTable('location_latest', {
  userId: text('user_id').primaryKey(),
  branch: text('branch').notNull().default(''),
  recordedAt: moment('recorded_at').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  accuracyM: real('accuracy_m'),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [index('location_latest_updated_idx').on(t.updatedAt)]);

/**
 * What the phone says about itself (a heartbeat every few minutes and with each batch), so a manager can
 * see WHY someone is quiet: permission downgraded, Low Power Mode, a low or dying battery, an old app.
 * One row per person; the newest heartbeat wins. Never holds a position.
 */
export const locationDeviceHealth = pgTable('location_device_health', {
  userId: text('user_id').primaryKey(),
  /** 'always' | 'when-in-use' | 'denied' | 'unknown' */
  permission: text('permission').notNull().default('unknown'),
  lowPower: boolean('low_power').notNull().default(false),
  /** 0–100, null when the phone can't say. */
  batteryPct: integer('battery_pct'),
  charging: boolean('charging').notNull().default(false),
  appVersion: text('app_version').notNull().default(''),
  /** Points waiting on the phone to be sent. */
  queued: integer('queued').notNull().default(0),
  reportedAt: moment('reported_at').notNull(),
  receivedAt: moment('received_at').notNull().defaultNow()
});

/**
 * Who looked at whose location (2026-11-22; owner: admins see it, the tracked person does not). Written
 * by the server for every read of a person's position or trail and every Locate now ask; append-only, no
 * route updates or deletes a row, kept 1 year and not deleted with the points. No foreign keys, like the points.
 */
export const locationViewLog = pgTable('location_view_log', {
  id: objectId('id').primaryKey(),
  viewerId: text('viewer_id').notNull(),
  viewerName: text('viewer_name').notNull().default(''),
  subjectId: text('subject_id').notNull(),
  subjectName: text('subject_name').notNull().default(''),
  /** 'live' (the map / list), 'trail' (one day's trail), 'locate' (a Locate now ask). */
  kind: text('kind').notNull(),
  /** The branch-clock day looked at, for a trail; '' otherwise. */
  day: text('day').notNull().default(''),
  viewedAt: moment('viewed_at').notNull().defaultNow()
}, t => [
  index('location_view_log_subject_time_idx').on(t.subjectId, t.viewedAt),
  index('location_view_log_viewer_time_idx').on(t.viewerId, t.viewedAt),
  index('location_view_log_time_idx').on(t.viewedAt)
]);
