import type { Loose } from '../types/records.ts';
/**
 * Keeps freight charges in step with the Delivery Schedule (2026-10-09).
 *
 * The rules are planSync's (freightRules.js); this file reads the delivery
 * and its charge, applies the plan, and writes history — in one transaction,
 * so a charge never changes without its history line.
 *
 * Two entry points:
 *   syncDeliveryIds(ids) — straight after a delivery save (hooks.js)
 *   reconcile()          — on a timer and at boot: every completed 3rd-party
 *                          delivery since the start date, and every open
 *                          charge's delivery, so nothing missed stays missed.
 * Both are safe to run again: one charge per delivery (a unique index), and a
 * plan that has nothing to change does nothing.
 */
import { THIRD_PARTY_TRUCK_ID, THIRD_PARTY_NAME } from '../utils/deliveryPickup.ts';
import { inAccountingTransaction, accountingStore } from '../db/accounting/index.ts';
import { newId } from '../db/ids.ts';
import { planSync, matchCarrier, DERIVED_FIELDS } from './freightRules.ts';

const SYSTEM = { id: 'system', name: 'Delivery Schedule' };
const DELIVERY_FIELDS = 'id status deliveryType truckId date soNumber customerName location carrierName proNumber freightFee';
const TRUCK_CACHE_MS = 60 * 1000;

export function createFreightSync({ Delivery, User, startDate = '', log = console }: Loose = {}) {
  let truckCache: { at: number; ids: Set<string> | null } = { at: 0, ids: null };

  /**
   * Every truck id the 3rd-party column can have: the built-in row, and each
   * driver account named "3rd party…" — boards file those as drv_<username>,
   * older tickets by the user's _id.
   */
  async function thirdPartyTruckIds() {
    if (truckCache.ids && Date.now() - truckCache.at < TRUCK_CACHE_MS) return truckCache.ids;
    const users = await User.find({ $or: [{ name: THIRD_PARTY_NAME }, { username: THIRD_PARTY_NAME }] }, '_id username').lean();
    const ids = new Set([THIRD_PARTY_TRUCK_ID]);
    for (const u of users) {
      if (u.username) ids.add(`drv_${u.username}`);
      ids.add(String(u._id));
    }
    truckCache = { at: Date.now(), ids };
    return ids;
  }

  /**
   * Is this truck the 3rd-party column? The cached list answers most; a truck
   * it doesn't know (a driver account added in the last minute) is looked up
   * directly, so a brand-new carrier account isn't missed until the next run.
   */
  async function isThirdPartyTruck(truckId: unknown, ctx: Loose) {
    const id = String(truckId || '');
    if (!id) return false;
    if (ctx.truckIds.has(id)) return true;
    let user = null;
    if (id.startsWith('drv_')) user = await User.findOne({ username: id.slice(4) }, '_id username name').lean();
    else if (/^[a-f0-9]{24}$/i.test(id)) user = await User.findById(id, '_id username name').lean();
    const yes = Boolean(user && THIRD_PARTY_NAME.test(`${user.name || ''} ${user.username || ''}`));
    if (yes) { ctx.truckIds.add(id); truckCache = { at: 0, ids: null }; }
    return yes;
  }

  async function syncOne(deliveryId: string, ctx: Loose) {
    const [delivery, charge] = await Promise.all([
      Delivery.findOne({ id: deliveryId }, DELIVERY_FIELDS).lean(),
      accountingStore().then(store => store.chargeForDelivery(deliveryId))
    ]);
    if (!delivery && !charge) return 'none';
    const thirdParty = delivery ? await isThirdPartyTruck(delivery.truckId, ctx) : false;
    const carrier = delivery ? matchCarrier(ctx.carriers, delivery.carrierName) : null;
    const plan = planSync({
      charge,
      delivery,
      thirdParty,
      carrierId: carrier?._id || null,
      startDate
    });
    if (plan.op === 'none') return 'none';

    await inAccountingTransaction(async (store) => {
      if (plan.op === 'create') {
        const created = await store.createCharge({ ...plan.doc, createdBy: SYSTEM, updatedBy: SYSTEM });
        await store.addAudit([{
          entityType: 'charge', entityId: String(created._id), action: 'created', by: SYSTEM,
          note: `From delivery SO# ${created.soNumber || '—'} (completed on the 3rd-party truck)`,
          changes: DERIVED_FIELDS.map((f) => ({ field: f, from: null, to: created[f] ?? null })).filter((c) => c.to !== null && c.to !== '')
        }]);
        return;
      }
      if (!charge) throw new Error('Freight charge was missing while applying a delivery update');
      const doc = await store.charge(charge._id);
      if (!doc) throw new Error('Freight charge was removed while applying a delivery update');
      const changes: Loose[] = [];
      for (const [field, value] of Object.entries(plan.set)) {
        if (field !== 'sourceSnapshot') changes.push({ field, from: doc[field] ?? null, to: value ?? null });
        doc[field] = value;
      }
      if (plan.clearReopened) {
        for (const f of doc.flags) if (f.code === 'delivery_reopened' && !f.resolvedAt) { f.resolvedAt = new Date(); f.resolvedBy = SYSTEM; }
      }
      if (plan.flag) doc.flags = [...doc.flags, { _id: newId(), ...plan.flag }];
      doc.updatedBy = SYSTEM;
      if (!(await store.saveCharge(doc))) throw new Error('Freight charge was changed by someone else while applying a delivery update');
      const notes: string[] = [];
      if (plan.flag) notes.push(`Flagged for review: ${plan.flag.detail}`);
      if (plan.clearReopened) notes.push('The delivery is completed on the 3rd-party truck again');
      if (changes.length || notes.length) {
        await store.addAudit([{
          entityType: 'charge', entityId: String(doc._id), action: plan.flag ? 'flagged' : 'updated_from_delivery',
          by: SYSTEM, changes, note: notes.join('. ')
        }]);
      }
    });
    return plan.op;
  }

  async function context() {
    const [truckIds, carriers] = await Promise.all([thirdPartyTruckIds(), accountingStore().then(store => store.carriers(null))]);
    return { truckIds: new Set(truckIds), carriers };
  }

  /** After a delivery save. Each delivery is tried on its own, and retried once on a clash. */
  async function syncDeliveryIds(ids: string[] = []) {
    const ctx = await context();
    const results: Loose = {};
    for (const id of ids) {
      try {
        results[id] = await syncOne(id, ctx);
      } catch (err) {
        // A duplicate (two saves racing to create the same charge) or an edit
        // racing this one: the second attempt sees the other's result.
        try { results[id] = await syncOne(id, ctx); } catch (err2) {
          results[id] = 'error';
          log.error?.(`[accounting] freight sync for delivery ${id} failed:`, (err2 as Error)?.message || (err as Error)?.message);
        }
      }
    }
    return results;
  }

  /** Everything that should have a charge, and every charge that should be checked. */
  async function reconcile() {
    const truckIds = await thirdPartyTruckIds();
    const query: Loose = { status: 'completed', truckId: { $in: [...truckIds] }, deliveryType: { $ne: 'will_call' } };
    if (startDate) query.date = { $gte: startDate };
    const [owed, open] = await Promise.all([
      Delivery.find(query, 'id').lean(),
      accountingStore().then(store => store.openDeliveryChargeIds())
    ]);
    const ids = new Set<string>([...owed.map((d: Loose) => d.id), ...open].filter(Boolean));
    const results = await syncDeliveryIds([...ids]);
    const counts = Object.values(results).reduce((acc, r) => ({ ...acc, [r]: (acc[r] || 0) + 1 }), {});
    return { checked: ids.size, ...counts };
  }

  /** A carrier was added or renamed: charges waiting without a carrier get matched. */
  async function matchUnassigned(by = SYSTEM) {
    const store = await accountingStore();
    const carriers = await store.carriers(null);
    const waiting = await store.chargesWaitingForCarrier();
    let matched = 0;
    for (const charge of waiting) {
      const carrier = matchCarrier(carriers, charge.carrierNameRaw);
      if (!carrier) continue;
      try {
        await inAccountingTransaction(async (tx) => {
          const doc = await tx.charge(charge._id);
          if (!doc) throw new Error('Freight charge was removed while matching its carrier');
          if (doc.carrierId || doc.status !== 'draft') return;
          doc.carrierId = carrier._id;
          doc.updatedBy = by;
          if (!(await tx.saveCharge(doc))) throw new Error('Freight charge was changed by someone else while matching its carrier');
          await tx.addAudit([{
            entityType: 'charge', entityId: String(doc._id), action: 'carrier_matched', by,
            changes: [{ field: 'carrierId', from: null, to: String(carrier._id) }],
            note: `“${doc.carrierNameRaw}” matched to ${carrier.name}`
          }]);
          matched += 1;
        });
      } catch (err) {
        log.error?.(`[accounting] matching carrier for charge ${charge._id} failed:`, (err as Error)?.message);
      }
    }
    return matched;
  }

  return { syncDeliveryIds, reconcile, matchUnassigned, thirdPartyTruckIds };
}
