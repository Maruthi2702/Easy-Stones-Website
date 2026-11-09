/** MongoDB → Postgres rows for Credit Card Receipts and Suppliers (src/db/schema/cardsSuppliers.ts). */
import type { Loose } from '../../types/records.ts';
import type {
  companyCards, receiptCategories, cardExpenses, cardExpenseHistory, suppliers, supplierHistory, supplierLogins,
  supplierPos, supplierPoLines, supplierPoHistory, supplierBlocks, supplierBundles, supplierBlockHistory
} from '../schema/cardsSuppliers.ts';
import { CARD_EXPENSE_STATUSES, BUNDLE_STATUSES } from '../schema/cardsSuppliers.ts';
import type { ReferenceIndex } from './referenceRows.ts';
import type { CustomerIndex } from './customerRows.ts';
import { stamp } from './referenceRows.ts';
import { plainJson } from './linkedRows.ts';
import {
  idOf, textOf, rowConverter, intOf, pickOf, decimalOf, stringsOf, boolOf, locationIdOf, linkOf, type CopyProblem
} from './values.ts';

type Row<T extends { $inferInsert: unknown }> = T['$inferInsert'];
type Converter = ReturnType<typeof rowConverter>;

export interface CardsSuppliersSource {
  companyCards: Loose[];
  receiptCategories: Loose[];
  cardExpenses: Loose[];
  suppliers: Loose[];
  supplierLogins: Loose[];
  supplierPos: Loose[];
  supplierBlocks: Loose[];
}

export interface CardsSuppliersRows {
  companyCards: Row<typeof companyCards>[];
  receiptCategories: Row<typeof receiptCategories>[];
  cardExpenses: Row<typeof cardExpenses>[];
  cardExpenseHistory: Row<typeof cardExpenseHistory>[];
  suppliers: Row<typeof suppliers>[];
  supplierHistory: Row<typeof supplierHistory>[];
  supplierLogins: Row<typeof supplierLogins>[];
  supplierPos: Row<typeof supplierPos>[];
  supplierPoLines: Row<typeof supplierPoLines>[];
  supplierPoHistory: Row<typeof supplierPoHistory>[];
  supplierBlocks: Row<typeof supplierBlocks>[];
  supplierBundles: Row<typeof supplierBundles>[];
  supplierBlockHistory: Row<typeof supplierBlockHistory>[];
}

const obj = (v: unknown): Loose => (v && typeof v === 'object' ? v : {}) as Loose;
const optObj = (v: unknown): Loose | null => (v && typeof v === 'object' ? v as Loose : null);
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const optText = (v: unknown): string | null => v == null ? null : String(v);
const noteOf = (v: unknown) => (v && typeof v === 'object' ? plainJson(v) : null);
const ZONE = 'America/Los_Angeles';

function historyRows(c: Converter, parentId: string, history: unknown) {
  const out: { parentId: string; position: number; at: Date; by: string; side: string; action: string; changes: string }[] = [];
  list(history).forEach((h, position) => {
    const x = obj(h), at = c.moment('history.at', x.at);
    if (!at || !x.action) { c.problem('history', 'history line with no time or action', 'skipped'); return; }
    out.push({ parentId, position, at, by: textOf(x.by), side: textOf(x.side) || 'staff', action: textOf(x.action), changes: textOf(x.changes) });
  });
  return out;
}

export function cardsSuppliersRows(src: CardsSuppliersSource, ref: ReferenceIndex, cust: CustomerIndex, problems: CopyProblem[]): CardsSuppliersRows {
  const rows: CardsSuppliersRows = {
    companyCards: [], receiptCategories: [], cardExpenses: [], cardExpenseHistory: [], suppliers: [], supplierHistory: [],
    supplierLogins: [], supplierPos: [], supplierPoLines: [], supplierPoHistory: [], supplierBlocks: [], supplierBundles: [],
    supplierBlockHistory: []
  };
  const cardIds = new Set<string>(), categoryNames = new Set<string>(), supplierIds = new Set<string>(), poIds = new Set<string>();

  for (const d of src.companyCards) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'company_cards', id);
    const userId = linkOf(c, 'user_id', d.userId, ref.userIds, 'user');
    if (!userId) { c.problem('user_id', 'card of no user', 'skipped'); continue; }
    cardIds.add(id);
    rows.companyCards.push({
      id, userId, label: textOf(d.label), issuer: pickOf(c, 'issuer', d.issuer, ['amex', 'other'] as const, 'amex'),
      lastDigits: textOf(d.lastDigits), active: boolOf(d.active, true), updatedBy: textOf(d.updatedBy), ...stamp(c, d)
    });
  }

  for (const d of src.receiptCategories) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'receipt_categories', id);
    categoryNames.add(textOf(d.name));
    const f = obj(d.fields);
    rows.receiptCategories.push({
      id, name: textOf(d.name), label: textOf(d.label), order: intOf(c, 'order', d.order) ?? 0, active: boolOf(d.active, true),
      needsCustomer: boolOf(f.customer), needsAttendees: boolOf(f.attendees), needsPurpose: boolOf(f.purpose),
      needsRecurring: boolOf(f.recurring), updatedBy: textOf(d.updatedBy), ...stamp(c, d)
    });
  }

  for (const d of src.cardExpenses) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'card_expenses', id);
    const expenseDay = c.day('day', d.date, ref.zoneOfLocation(d.location));
    const cents = intOf(c, 'cents', d.cents);
    const status = pickOf(c, 'status', d.status, CARD_EXPENSE_STATUSES, null);
    if (!expenseDay || cents == null || !status) { c.problem('id', 'no day, amount or status', 'skipped'); continue; }
    let category: string | null = textOf(d.category) || null;
    if (category && !categoryNames.has(category)) { c.problem('category', 'not a receipt category', 'blanked'); category = null; }
    const approval = optObj(d.approval), sentBack = optObj(d.sentBack);
    rows.cardExpenses.push({
      id, userId: linkOf(c, 'user_id', d.userId, ref.userIds, 'user'), holderName: textOf(d.holderName),
      cardId: linkOf(c, 'card_id', d.cardId, cardIds, 'card'), cardLabel: textOf(d.cardLabel),
      locationId: locationIdOf(c, 'location_id', d.location, ref.locationIdByName), day: expenseDay, month: textOf(d.month),
      merchant: textOf(d.merchant), cents, subtotalCents: intOf(c, 'subtotal_cents', d.subtotalCents),
      taxCents: intOf(c, 'tax_cents', d.taxCents), tipCents: intOf(c, 'tip_cents', d.tipCents), category,
      customerId: linkOf(c, 'customer_id', d.customerId, cust.customerIds, 'customer'), customerName: textOf(d.customerName),
      attendees: stringsOf(d.attendees), purpose: textOf(d.purpose), note: textOf(d.note), recurring: boolOf(d.recurring),
      receiptUrl: textOf(d.receiptUrl), lostReason: textOf(d.lostReason), status,
      approvedById: approval ? textOf(approval.by) : null, approvedByName: approval ? textOf(approval.byName) : null,
      approvedAt: approval ? c.moment('approved_at', approval.at) : null, approvalComment: approval ? textOf(approval.comment) : null,
      sentBackById: sentBack ? textOf(sentBack.by) : null, sentBackByName: sentBack ? textOf(sentBack.byName) : null,
      sentBackAt: sentBack ? c.moment('sent_back_at', sentBack.at) : null, sentBackComment: sentBack ? textOf(sentBack.comment) : null,
      createdBy: textOf(d.createdBy), voidedAt: c.moment('voided_at', d.voidedAt), voidedBy: textOf(d.voidedBy),
      voidReason: textOf(d.voidReason), ...stamp(c, d)
    });
    for (const h of historyRows(c, id, d.history)) {
      rows.cardExpenseHistory.push({ expenseId: id, position: h.position, at: h.at, by: h.by, action: h.action, changes: h.changes });
    }
  }

  for (const d of src.suppliers) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'suppliers', id);
    supplierIds.add(id);
    rows.suppliers.push({
      id, name: textOf(d.name), spsName: textOf(d.spsName), spsKey: textOf(d.spsKey), country: textOf(d.country),
      language: textOf(d.language) || 'en', timeZone: textOf(d.timeZone), contactName: textOf(d.contactName),
      email: textOf(d.email), phone: textOf(d.phone), notes: textOf(d.notes), active: boolOf(d.active, true),
      createdBy: textOf(d.createdBy), ...stamp(c, d)
    });
    rows.supplierHistory.push(...historyRows(c, id, d.history));
  }

  for (const d of src.supplierLogins) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'supplier_logins', id);
    const supplierId = linkOf(c, 'supplier_id', d.supplierId, supplierIds, 'supplier');
    if (!supplierId) { c.problem('supplier_id', 'login of no supplier', 'skipped'); continue; }
    rows.supplierLogins.push({
      id, supplierId, name: textOf(d.name), email: textOf(d.email), password: textOf(d.password),
      language: textOf(d.language) || 'en', active: boolOf(d.active, true), sessionVersion: intOf(c, 'session_version', d.sessionVersion) ?? 0,
      linkTokenHash: textOf(d.linkTokenHash), linkExpiresAt: c.moment('link_expires_at', d.linkExpiresAt),
      loginAttempts: intOf(c, 'login_attempts', d.loginAttempts) ?? 0, lockUntil: c.moment('lock_until', d.lockUntil),
      lastLoginAt: c.moment('last_login_at', d.lastLoginAt), lastSeenAt: c.moment('last_seen_at', d.lastSeenAt),
      invitedAt: c.moment('invited_at', d.invitedAt), invitedBy: textOf(d.invitedBy), ...stamp(c, d)
    });
  }

  for (const d of src.supplierPos) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'supplier_pos', id);
    const supplierId = linkOf(c, 'supplier_id', d.supplierId, supplierIds, 'supplier');
    if (!supplierId) { c.problem('supplier_id', 'PO of no supplier', 'skipped'); continue; }
    poIds.add(id);
    rows.supplierPos.push({
      id, poNumber: textOf(d.poNumber), supplierId, supplierName: textOf(d.supplierName), shipTo: textOf(d.shipTo),
      readyBy: c.day('ready_by', d.readyBy, ZONE), buyerId: textOf(d.buyerId), buyerName: textOf(d.buyerName),
      note: noteOf(d.note), source: pickOf(c, 'source', d.source, ['typed', 'sps'] as const, 'typed'),
      status: pickOf(c, 'status', d.status, ['open', 'closed', 'cancelled'] as const, 'open'), statusReason: textOf(d.statusReason),
      assignedAt: c.moment('assigned_at', d.assignedAt), createdBy: textOf(d.createdBy), version: intOf(c, 'version', d.__v) ?? 0,
      ...stamp(c, d)
    });
    list(d.lines).forEach((l, position) => {
      const x = obj(l);
      if (!x._id) { c.problem('lines.id', 'line with no id', 'skipped'); return; }
      rows.supplierPoLines.push({
        poId: id, id: textOf(x._id), position, material: textOf(x.material), thickness: textOf(x.thickness),
        finish: textOf(x.finish), slabs: intOf(c, 'lines.slabs', x.slabs) ?? 0, note: textOf(x.note)
      });
    });
    rows.supplierPoHistory.push(...historyRows(c, id, d.history));
  }

  const step = (c: Converter, prefix: 'step1' | 'step2', v: unknown) => {
    const s = optObj(v);
    return {
      [`${prefix}Decision`]: s ? pickOf(c, `${prefix}.decision`, s.decision, ['approve', 'reject', 'retake'] as const, null) : null,
      [`${prefix}By`]: s ? textOf(s.by) : null, [`${prefix}ByName`]: s ? textOf(s.byName) : null,
      [`${prefix}At`]: s ? c.moment(`${prefix}.at`, s.at) : null, [`${prefix}Reason`]: s ? textOf(s.reason) : null
    };
  };

  for (const d of src.supplierBlocks) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'supplier_blocks', id);
    const poId = linkOf(c, 'po_id', d.poId, poIds, 'PO'), supplierId = linkOf(c, 'supplier_id', d.supplierId, supplierIds, 'supplier');
    if (!poId || !supplierId) { c.problem('id', 'block of no PO or supplier', 'skipped'); continue; }
    const size = optObj(d.size);
    rows.supplierBlocks.push({
      id, poId, poNumber: textOf(d.poNumber), supplierId, lineId: textOf(d.lineId), material: textOf(d.material),
      thickness: textOf(d.thickness), finish: textOf(d.finish), blockNumber: textOf(d.blockNumber),
      sizeLength: size ? decimalOf(size.length) : null, sizeHeight: size ? decimalOf(size.height) : null,
      sizeUnit: size ? pickOf(c, 'size_unit', size.unit, ['in', 'cm'] as const, 'in') : null,
      note: noteOf(d.note), decisionNote: noteOf(d.decisionNote), stage: textOf(d.stage) || 'draft',
      firstSentAt: c.moment('first_sent_at', d.firstSentAt), enteredBy: textOf(d.enteredBy), enteredById: textOf(d.enteredById),
      sentAt: c.moment('sent_at', d.sentAt), createdBy: textOf(d.createdBy), version: intOf(c, 'version', d.__v) ?? 0,
      ...stamp(c, d)
    });
    list(d.bundles).forEach((b, position) => {
      const x = obj(b), unlock = optObj(x.unlock);
      if (!x._id) { c.problem('bundles.id', 'bundle with no id', 'skipped'); return; }
      rows.supplierBundles.push({
        blockId: id, id: textOf(x._id), position, n: intOf(c, 'bundles.n', x.n) ?? position + 1, slabs: intOf(c, 'bundles.slabs', x.slabs),
        photoUrl: textOf(x.photoUrl), photoAt: c.moment('bundles.photo_at', x.photoAt),
        previousPhotos: list(x.previousPhotos).map(p => plainJson({ url: obj(p).url ?? '', at: obj(p).at ?? null })),
        status: pickOf(c, 'bundles.status', x.status, BUNDLE_STATUSES, 'draft'), round: intOf(c, 'bundles.round', x.round) ?? 0,
        sentAt: c.moment('bundles.sent_at', x.sentAt), ...step(c, 'step1', x.step1), ...step(c, 'step2', x.step2),
        reason: textOf(x.reason), comment: noteOf(x.comment),
        unlockBy: unlock ? textOf(unlock.by) : null, unlockAt: unlock ? c.moment('bundles.unlock_at', unlock.at) : null,
        unlockReason: unlock ? textOf(unlock.reason) : null
      } as Row<typeof supplierBundles>);
    });
    rows.supplierBlockHistory.push(...historyRows(c, id, d.history));
  }

  return rows;
}
