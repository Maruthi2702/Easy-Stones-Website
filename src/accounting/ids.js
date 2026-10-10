/**
 * Transaction and payment IDs (2026-10-09): every accounting record that
 * moves money or status gets one, so a payment can be traced from the check
 * stub to every charge it covered, and two records can never be mixed up.
 *
 *   TX-20261009-7K3Q9XAB    one history entry (created, approved, paid, voided…)
 *   PAY-20261009-K2M8D4RT   one payment: the money that went out, and every
 *                           charge (or invoice) it paid
 *
 * The date is when it was recorded (UTC) — for reading, not for sorting. The
 * rest is 40 random bits in Crockford base32 (no I, L, O or U, so it reads
 * aloud and types back without mix-ups). Uniqueness is enforced by a unique
 * index on each collection; a clash, about one in a trillion, makes the save
 * fail with nothing written rather than reuse an ID.
 *
 * Server-only (node:crypto).
 */
import { randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RANDOM_CHARS = 8; // 8 × 5 bits = 40 bits

export const ID_PATTERN = /^(TX|PAY)-\d{8}-[0-9A-HJKMNP-TV-Z]{8}$/;

export function newId(prefix, now = new Date()) {
  const bytes = randomBytes(RANDOM_CHARS);
  let tail = '';
  for (let i = 0; i < RANDOM_CHARS; i += 1) tail += CROCKFORD[bytes[i] & 31];
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}-${day}-${tail}`;
}

export const newTxnId = (now) => newId('TX', now);
export const newPaymentId = (now) => newId('PAY', now);
