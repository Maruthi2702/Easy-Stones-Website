/**
 * The hold expiry job (2026-10-10). Two steps, both logged:
 *
 *   1. A hold whose expiry date has passed gets an "expired" history line. It
 *      keeps its slabs — the person can still extend it.
 *   2. GRACE_DAYS (7) after the expiry date it is released and its slabs are
 *      freed (owner's call: free up slabs 7 days after the expiry date).
 *
 * Runs at boot and on a timer (server.js). Safe to run again and from two
 * servers at once: each hold is re-read inside its own transaction and only
 * changed if it is still due.
 */
import { inTransaction } from '../server/http.js';
import { Hold, SlabReservation, HoldHistory } from './models.js';
import { GRACE_DAYS } from './holdRules.js';

const SYSTEM = Object.freeze({ id: 'system', name: 'Hold expiry' });
const BATCH = 100;

export function createHoldExpiry({ io = null, log = console } = {}) {
  const announce = (slabKeys) => { if (slabKeys.length) io?.emit('slab_reservations_changed', { slabKeys }); };

  async function noteExpired(now) {
    const due = await Hold.find({ status: 'active', expiresAt: { $lte: now }, releaseAt: { $gt: now }, expiredNotedAt: null }, '_id').limit(BATCH).lean();
    let noted = 0;
    for (const { _id } of due) {
      try {
        await inTransaction(async (session) => {
          const hold = await Hold.findById(_id).session(session);
          if (!hold || hold.status !== 'active' || hold.expiredNotedAt || hold.expiresAt > now) return;
          hold.expiredNotedAt = now;
          await hold.save({ session });
          await HoldHistory.create([{
            holdId: hold._id, holdNumber: hold.number, action: 'expired', by: SYSTEM,
            note: `Expired on ${hold.expiresOn}. The slabs stay held for ${GRACE_DAYS} more days — extend it to keep them.`
          }], { session });
          noted += 1;
        });
      } catch (err) {
        log.error?.(`[holds] noting hold ${_id} expired failed:`, err?.message);
      }
    }
    return noted;
  }

  async function releaseDue(now) {
    const due = await Hold.find({ status: 'active', releaseAt: { $lte: now } }, '_id').limit(BATCH).lean();
    let released = 0;
    for (const { _id } of due) {
      try {
        const keys = await inTransaction(async (session) => {
          const hold = await Hold.findById(_id).session(session);
          if (!hold || hold.status !== 'active' || hold.releaseAt > now) return [];
          hold.status = 'released';
          hold.releasedAt = now;
          hold.releasedBy = SYSTEM;
          hold.releaseReason = `Expired on ${hold.expiresOn}; slabs freed ${GRACE_DAYS} days later.`;
          hold.updatedBy = SYSTEM;
          await hold.save({ session });
          await SlabReservation.deleteMany({ holdId: hold._id }, { session });
          await HoldHistory.create([{
            holdId: hold._id, holdNumber: hold.number, action: 'released', by: SYSTEM,
            changes: [{ field: 'status', from: 'active', to: 'released' }], note: hold.releaseReason
          }], { session });
          return hold.slabKeys;
        });
        if (keys.length) { released += 1; announce(keys); }
      } catch (err) {
        log.error?.(`[holds] releasing hold ${_id} failed:`, err?.message);
      }
    }
    return released;
  }

  /** One pass: note what just expired, release what's past its grace period. */
  async function run(now = new Date()) {
    const noted = await noteExpired(now);
    const released = await releaseDue(now);
    return { noted, released };
  }

  return { run };
}
