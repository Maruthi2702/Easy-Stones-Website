import type { Loose } from '../types/records.ts';
/**
 * The hold expiry job (2026-10-10). Two steps, both logged:
 *
 *   1. A hold whose expiry date has passed gets an "expired" history line. It
 *      keeps its slabs — the person can still extend it.
 *   2. GRACE_DAYS (7) after the expiry date it is released and its slabs are
 *      freed (owner's call: free up slabs 7 days after the expiry date).
 *
 * Runs at boot and on a timer (server.ts). Safe to run again and from two
 * servers at once: each hold is re-read inside its own transaction and only
 * changed if it is still due.
 */
import { inHoldsTransaction, holdsStore } from '../db/holds/index.ts';
import { GRACE_DAYS } from './holdRules.ts';

const SYSTEM = Object.freeze({ id: 'system', name: 'Hold expiry' });
const BATCH = 100;

export function createHoldExpiry({ io = null, log = console }: Loose = {}) {
  const announce = (slabKeys: Loose) => { if (slabKeys.length) io?.emit('slab_reservations_changed', { slabKeys }); };

  async function noteExpired(now: Date) {
    const due = await (await holdsStore()).holdsToNote(now, BATCH);
    let noted = 0;
    for (const id of due) {
      try {
        await inHoldsTransaction(async (store) => {
          const hold = await store.findHold(id);
          if (!hold || hold.status !== 'active' || hold.expiredNotedAt || hold.expiresAt > now) return;
          hold.expiredNotedAt = now;
          const saved = await store.saveHold(hold);
          if (!saved) return; // changed meanwhile: the next pass looks again
          await store.addHistory([{
            holdId: hold._id, holdNumber: hold.number, action: 'expired', by: SYSTEM,
            note: `Expired on ${hold.expiresOn}. The slabs stay held for ${GRACE_DAYS} more days — extend it to keep them.`
          }]);
          noted += 1;
        });
      } catch (err) {
        log.error?.(`[holds] noting hold ${id} expired failed:`, (err as Error)?.message);
      }
    }
    return noted;
  }

  async function releaseDue(now: Date) {
    const due = await (await holdsStore()).holdsToRelease(now, BATCH);
    let released = 0;
    for (const id of due) {
      try {
        const keys = await inHoldsTransaction(async (store) => {
          const hold = await store.findHold(id);
          if (!hold || hold.status !== 'active' || hold.releaseAt > now) return [];
          hold.status = 'released';
          hold.releasedAt = now;
          hold.releasedBy = SYSTEM;
          hold.releaseReason = `Expired on ${hold.expiresOn}; slabs freed ${GRACE_DAYS} days later.`;
          hold.updatedBy = SYSTEM;
          const saved = await store.saveHold(hold);
          if (!saved) return [];
          await store.unlockHold(hold._id);
          await store.addHistory([{
            holdId: hold._id, holdNumber: hold.number, action: 'released', by: SYSTEM,
            changes: [{ field: 'status', from: 'active', to: 'released' }], note: hold.releaseReason
          }]);
          return hold.slabKeys as string[];
        });
        if (keys.length) { released += 1; announce(keys); }
      } catch (err) {
        log.error?.(`[holds] releasing hold ${id} failed:`, (err as Error)?.message);
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
