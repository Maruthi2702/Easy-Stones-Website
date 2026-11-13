import type { Loose } from '../types/records.ts';
import { sendEmail } from './emailService.ts';
import { geocodeAlertFor } from '../utils/geocodeAlert.ts';

/**
 * Tell the owner when a new customer's map lookup fails (owner's ask,
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

export async function alertGeocodeFailure(args: { company?: string; address?: Loose; geocode?: Loose; customerId?: string }, now = Date.now()) {
  try {
    const alert = geocodeAlertFor(args);
    if (!alert) return;
    const to = String(process.env.GEOCODE_ALERT_EMAIL || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!to.length) {
      console.warn('Map location failed for a new customer, and GEOCODE_ALERT_EMAIL is not set — no email sent.');
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

/** For tests. */
export const resetGeocodeAlertThrottle = () => lastSent.clear();
