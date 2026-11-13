/**
 * MongoDB → Postgres rows for Check In and Cart & Holds
 * (src/db/schema/checkInsHolds.ts).
 */
import type { Loose } from '../../types/records.ts';
import type {
  officeCheckIns, checkInSelections, salesCarts, salesCartLines, salesHolds, salesHoldLines,
  salesSlabReservations, salesCounters, salesHoldHistory
} from '../schema/checkInsHolds.ts';
import { CHECK_IN_STATUSES, HOLD_STATUSES } from '../schema/checkInsHolds.ts';
import type { ReferenceIndex } from './referenceRows.ts';
import type { CustomerIndex } from './customerRows.ts';
import { stamp } from './referenceRows.ts';
import { plainJson } from './linkedRows.ts';
import { idOf, idTime, textOf, rowConverter, intOf, pickOf, stringsOf, locationIdOf, linkOf, type CopyProblem } from './values.ts';

type Row<T extends { $inferInsert: unknown }> = T['$inferInsert'];

export interface CheckInsHoldsSource {
  officeCheckIns: Loose[];
  salesCarts: Loose[];
  salesHolds: Loose[];
  salesSlabReservations: Loose[];
  salesCounters: Loose[];
  salesHoldHistory: Loose[];
}

export interface CheckInsHoldsRows {
  officeCheckIns: Row<typeof officeCheckIns>[];
  checkInSelections: Row<typeof checkInSelections>[];
  salesCarts: Row<typeof salesCarts>[];
  salesCartLines: Row<typeof salesCartLines>[];
  salesHolds: Row<typeof salesHolds>[];
  salesHoldLines: Row<typeof salesHoldLines>[];
  salesSlabReservations: Row<typeof salesSlabReservations>[];
  salesCounters: Row<typeof salesCounters>[];
  salesHoldHistory: Row<typeof salesHoldHistory>[];
}

const obj = (v: unknown): Loose => (v && typeof v === 'object' ? v : {}) as Loose;

/**
 * The rows for one check-in and its Selection Sheet lines, or null when it has no id. The copy
 * and the Postgres saves (src/db/checkins/) both build rows here, so a save writes exactly what
 * a re-copy of MongoDB would make.
 */
export function checkInRowsOf(d: Loose, ref: ReferenceIndex, problems: CopyProblem[]):
  { checkIn: Row<typeof officeCheckIns>; selections: Row<typeof checkInSelections>[] } | null {
  const id = idOf(d._id);
  if (!id) return null;
  const c = rowConverter(problems, 'office_check_ins', id);
  const logged = obj(d.loggedBy);
  const selections: Row<typeof checkInSelections>[] = [];
  (Array.isArray(d.selections) ? d.selections : []).forEach((s: Loose, position: number) => {
    const sid = idOf(s._id);
    if (!sid) { c.problem('selections.id', 'selection line with no id', 'skipped'); return; }
    const price = intOf(c, 'selections.price_cents_per_sf', s.priceCentsPerSf);
    selections.push({
      id: sid, checkInId: id, position, material: textOf(s.material), details: textOf(s.details),
      size: textOf(s.size), lot: textOf(s.lot), priceCentsPerSf: price != null && price >= 1 ? price : null
    });
  });
  return {
    checkIn: {
      id, name: textOf(d.name), locationId: locationIdOf(c, 'location_id', d.location, ref.locationIdByName),
      phone: textOf(d.phone), email: textOf(d.email), fabricatorCompany: textOf(d.fabricatorCompany),
      fabricatorName: textOf(d.fabricatorName), fabricatorPhone: textOf(d.fabricatorPhone),
      status: pickOf(c, 'status', d.status, CHECK_IN_STATUSES, 'New'),
      builderName: textOf(d.builderName), builderPhone: textOf(d.builderPhone),
      specialNotes: textOf(d.specialNotes), internalNotes: textOf(d.internalNotes),
      salesRepName: textOf(d.salesRep), salesRepEmail: textOf(d.salesRepEmail),
      sheetEditedBy: textOf(d.sheetEditedBy), sheetEditedAt: c.moment('sheet_edited_at', d.sheetEditedAt),
      loggedByUserId: linkOf(c, 'logged_by_user_id', logged.userId, ref.userIds, 'user'),
      loggedByUsername: textOf(logged.username), loggedByDisplayName: textOf(logged.displayName),
      ...stamp(c, d)
    },
    selections
  };
}

export function checkInsHoldsRows(src: CheckInsHoldsSource, ref: ReferenceIndex, cust: CustomerIndex, problems: CopyProblem[]): CheckInsHoldsRows {
  const rows: CheckInsHoldsRows = {
    officeCheckIns: [], checkInSelections: [], salesCarts: [], salesCartLines: [], salesHolds: [], salesHoldLines: [],
    salesSlabReservations: [], salesCounters: [], salesHoldHistory: []
  };

  for (const d of src.officeCheckIns) {
    const built = checkInRowsOf(d, ref, problems);
    if (!built) continue;
    rows.officeCheckIns.push(built.checkIn);
    rows.checkInSelections.push(...built.selections);
  }

  for (const d of src.salesCarts) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'sales_carts', id);
    const userId = linkOf(c, 'user_id', d.userId, ref.userIds, 'user');
    if (!userId) { c.problem('user_id', 'cart of no user', 'skipped'); continue; }
    const customer = d.customer && typeof d.customer === 'object' ? d.customer as Loose : null;
    rows.salesCarts.push({
      id, userId, userName: textOf(d.userName),
      customerId: customer ? linkOf(c, 'customer_id', customer.id, cust.customerIds, 'customer') : null,
      customerName: customer ? textOf(customer.name) : null,
      ...stamp(c, d)
    });
    (Array.isArray(d.lines) ? d.lines : []).forEach((l: Loose, position: number) => {
      rows.salesCartLines.push({
        cartId: id, position, slabKey: textOf(l.slabKey), product: textOf(l.product), note: textOf(l.note),
        addedAt: c.moment('lines.added_at', l.addedAt) ?? idTime(d._id)
      });
    });
  }

  const holdIds = new Set<string>();
  for (const d of src.salesHolds) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'sales_holds', id);
    const locationId = locationIdOf(c, 'location_id', d.branch, ref.locationIdByName);
    const number = intOf(c, 'number', d.number);
    const expiresOn = c.day('expires_on', d.expiresOn, ref.zoneOfLocation(d.branch));
    const expiresAt = c.moment('expires_at', d.expiresAt), releaseAt = c.moment('release_at', d.releaseAt);
    if (!locationId || number == null || !expiresOn || !expiresAt || !releaseAt) {
      c.problem('id', 'no branch, number or expiry', 'skipped'); continue;
    }
    holdIds.add(id);
    const customer = obj(d.customer), createdBy = obj(d.createdBy), updatedBy = obj(d.updatedBy);
    const releasedBy = d.releasedBy && typeof d.releasedBy === 'object' ? d.releasedBy as Loose : null;
    rows.salesHolds.push({
      id, number, status: pickOf(c, 'status', d.status, HOLD_STATUSES, 'active'), locationId,
      customerId: linkOf(c, 'customer_id', customer.id, cust.customerIds, 'customer'),
      customerName: textOf(customer.name), customerContact: textOf(customer.contact), customerPhone: textOf(customer.phone),
      customerEmail: textOf(customer.email), customerAddress: textOf(customer.address),
      job: textOf(d.job), notes: textOf(d.notes), commissionNotes: textOf(d.commissionNotes),
      chanceToClose: intOf(c, 'chance_to_close', d.chanceToClose),
      expiresOn, expiresAt, releaseAt, expiredNotedAt: c.moment('expired_noted_at', d.expiredNotedAt),
      slabKeys: stringsOf(d.slabKeys),
      createdById: textOf(createdBy.id), createdByName: textOf(createdBy.name),
      updatedById: textOf(updatedBy.id), updatedByName: textOf(updatedBy.name),
      releasedAt: c.moment('released_at', d.releasedAt),
      releasedById: releasedBy ? textOf(releasedBy.id) : null, releasedByName: releasedBy ? textOf(releasedBy.name) : null,
      releaseReason: textOf(d.releaseReason), requestId: typeof d.requestId === 'string' ? d.requestId : null,
      version: intOf(c, 'version', d.__v) ?? 0,
      ...stamp(c, d)
    });
    (Array.isArray(d.lines) ? d.lines : []).forEach((l: Loose, position: number) => {
      rows.salesHoldLines.push({
        holdId: id, position, slabKey: textOf(l.slabKey), serial: textOf(l.serial), barcode: textOf(l.barcode),
        product: textOf(l.product), category: textOf(l.category), bundle: textOf(l.bundle), slabNumber: textOf(l.slabNumber),
        block: textOf(l.block), bin: textOf(l.bin), location: textOf(l.location), dimensions: textOf(l.dimensions),
        sfHundredths: intOf(c, 'lines.sf_hundredths', l.sfHundredths) ?? 0,
        priceCentsPerSf: intOf(c, 'lines.price_cents_per_sf', l.priceCentsPerSf), note: textOf(l.note)
      });
    });
  }

  for (const d of src.salesSlabReservations) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'sales_slab_reservations', id);
    const holdId = linkOf(c, 'hold_id', d.holdId, holdIds, 'hold');
    if (!holdId) { c.problem('hold_id', 'reservation of no hold', 'skipped'); continue; }
    const by = obj(d.by);
    rows.salesSlabReservations.push({
      id, slabKey: textOf(d.slabKey), holdId, holdNumber: intOf(c, 'hold_number', d.holdNumber) ?? 0,
      customerName: textOf(d.customerName), branch: textOf(d.branch), byId: textOf(by.id), byName: textOf(by.name),
      expiresOn: c.day('expires_on', d.expiresOn, ref.zoneOfLocation(d.branch)), ...stamp(c, d)
    });
  }

  for (const d of src.salesCounters) {
    if (typeof d._id !== 'string') continue;
    const c = rowConverter(problems, 'sales_counters', d._id);
    rows.salesCounters.push({ name: d._id, seq: intOf(c, 'seq', d.seq) ?? 0 });
  }

  for (const d of src.salesHoldHistory) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'sales_hold_history', id);
    const holdId = idOf(d.holdId), at = c.moment('at', d.at);
    if (!holdId || !at) { c.problem('id', 'no hold or no time', 'skipped'); continue; }
    const by = obj(d.by);
    rows.salesHoldHistory.push({
      id, holdId, holdNumber: intOf(c, 'hold_number', d.holdNumber) ?? 0, action: textOf(d.action),
      byId: textOf(by.id), byName: textOf(by.name), at,
      changes: (Array.isArray(d.changes) ? d.changes : []).map(x => plainJson({ field: x?.field ?? null, from: x?.from ?? null, to: x?.to ?? null })),
      note: textOf(d.note)
    });
  }

  return rows;
}
