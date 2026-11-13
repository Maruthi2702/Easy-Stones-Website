import type { Loose } from '../types/records.ts';
import { sendEmail } from './emailService.ts';
import { geocodeAlertFor, geocodeBatchAlertFor, type GeocodeAlert, type GeocodeFailure } from '../utils/geocodeAlert.ts';

/**
 * Tell the owner when a customer's map lookup fails (Add, Edit, and a bulk import) (owner's ask,
 * 2026-11-13: Google billing was off for a day and nobody knew, so new
 * customers silently had no pin). Recipients: GEOCODE_ALERT_EMAIL, one or more
 * addresses separated by commas — nothing is sent while it is unset.
 *
 * A setup problem (key / billing / quota) would otherwise email once per new
 * customer, so the same reason is sent at most once an hour. Never throws and
 * never delays a save: callers don't await it.
 */
const SETUP_REPEAT_MS = 60 * 60 * 1000;
const lastSent = new Map<string, number>();

async function deliver(alert: GeocodeAlert | null, now: number) {
  try {
    if (!alert) return;
    const to = String(process.env.GEOCODE_ALERT_EMAIL || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!to.length) {
      console.warn('Map location failed for new customers, and GEOCODE_ALERT_EMAIL is not set — no email sent.');
      return;
    }
    const last = lastSent.get(alert.throttleKey);
    if (alert.kind === 'setup' && last !== undefined && now - last < SETUP_REPEAT_MS) return;
    lastSent.set(alert.throttleKey, now);
    const result = await sendEmail({ to, subject: alert.subject, html: alert.html, defaultSenderName: 'Easy Surfaces Alerts' });
    if (!result.success) {
      lastSent.delete(alert.throttleKey);
      console.error('Map location alert email failed:', result.error);
    }
  } catch (error) {
    console.error('Map location alert failed:', error);
  }
}

/** One customer, from Add or Edit customer. */
export const alertGeocodeFailure = (args: { company?: string; address?: Loose; geocode?: Loose; customerId?: string }, now = Date.now()) =>
  deliver((() => { try { return geocodeAlertFor(args); } catch { return null; } })(), now);

/** A bulk write's failures (Excel / SPS import), as one email. */
export const alertGeocodeBatch = (failures: GeocodeFailure[], total: number, now = Date.now()) =>
  deliver((() => { try { return geocodeBatchAlertFor(failures, total); } catch { return null; } })(), now);

/** For tests. */
export const resetGeocodeAlertThrottle = () => lastSent.clear();
