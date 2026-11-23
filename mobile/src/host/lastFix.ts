/**
 * The newest position this app has read (from the background task or a one-off read). A page that asks "where am I" a moment after
 * the collector already knows gets that answer, instead of starting a second GPS read.
 */
export type Fix = { timestamp: number; coords: { latitude: number; longitude: number; accuracy: number; altitude: number | null; altitudeAccuracy: number | null; speed: number | null; heading: number | null } };

let last: Fix | null = null;

export const rememberFix = (fix: Fix): void => { if (!last || fix.timestamp >= last.timestamp) last = fix; };
export const forgetFix = (): void => { last = null; };

/** The remembered position if it is at most `maxAgeMs` old (0 or less asks for a fresh one), else null. */
export const fixWithin = (maxAgeMs: number, now: number = Date.now()): Fix | null =>
  last && maxAgeMs > 0 && now - last.timestamp <= maxAgeMs && last.timestamp <= now + 5_000 ? last : null;
