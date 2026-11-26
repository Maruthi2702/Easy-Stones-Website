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

/**
 * The row for one company card, or null when it has no id or no user. The copy and the Postgres
 * saves (src/db/cardReceipts/) both build rows here, so a save writes what a re-copy of MongoDB would.
 */
export function companyCardRowOf(d: Loose, ref: ReferenceIndex, problems: CopyProblem[]): Row<typeof companyCards> | null {
  const id = idOf(d._id);
  if (!id) return null;
  const c = rowConverter(problems, 'company_cards', id);
  // A card with no holder yet (set up from the Amex check before its holder has a login) keeps no user;
  // one whose holder is missing from the staff list is still skipped.
  const unassigned = d.userId == null || d.userId === '';
  const userId = unassigned ? null : linkOf(c, 'user_id', d.userId, ref.userIds, 'user');
  if (!userId && !unassigned) { c.problem('user_id', 'card of no user', 'skipped'); return null; }
  return {
    id, userId, label: textOf(d.label), issuer: pickOf(c, 'issuer', d.issuer, ['amex', 'encore', 'other'] as const, 'amex'),
    lastDigits: textOf(d.lastDigits), amexName: textOf(d.amexName), location: textOf(d.location), active: boolOf(d.active, true), updatedBy: textOf(d.updatedBy), ...stamp(c, d)
  };
}

/** A category's types as stored: [{ name, label, active, isDefault, fields }], in order, kept whole. */
const subcategoriesOf = (v: unknown) => (Array.isArray(v) ? v : []).map((s) => {
  const o = obj(s), f = obj(o.fields);
  return { name: textOf(o.name), label: textOf(o.label), active: boolOf(o.active, true), isDefault: boolOf(o.isDefault), fields: { customer: boolOf(f.customer), note: boolOf(f.note), recurring: boolOf(f.recurring) } };
}).filter((s) => s.name);

/** The row for one receipt category, or null when it has no id. */
export function receiptCategoryRowOf(d: Loose, problems: CopyProblem[]): Row<typeof receiptCategories> | null {
  const id = idOf(d._id);
  if (!id) return null;
  const c = rowConverter(problems, 'receipt_categories', id);
  const f = obj(d.fields);
  return {
    id, name: textOf(d.name), label: textOf(d.label), order: intOf(c, 'order', d.order) ?? 0, active: boolOf(d.active, true),
    needsCustomer: boolOf(f.customer), needsAttendees: false, needsPurpose: false, needsNote: boolOf(f.note),
    needsRecurring: boolOf(f.recurring), subcategories: subcategoriesOf(d.subcategories), updatedBy: textOf(d.updatedBy), ...stamp(c, d)
  };
}

/** What a card expense's links are checked against: the cards, categories and customers that exist. */
export interface ExpenseLinks { cardIds: Set<string>; categoryNames: Set<string>; customerIds: Set<string> }

/** The rows for one card expense and its history lines, or null when it has no id, day, amount or status. */
export function cardExpenseRowsOf(d: Loose, ref: ReferenceIndex, links: ExpenseLinks, problems: CopyProblem[]):
  { expense: Row<typeof cardExpenses>; history: Row<typeof cardExpenseHistory>[] } | null {
  const id = idOf(d._id);
  if (!id) return null;
  const c = rowConverter(problems, 'card_expenses', id);
  const expenseDay = c.day('day', d.date, ref.zoneOfLocation(d.location));
  const cents = intOf(c, 'cents', d.cents);
  const status = pickOf(c, 'status', d.status, CARD_EXPENSE_STATUSES, null);
  if (!expenseDay || cents == null || !status) { c.problem('id', 'no day, amount or status', 'skipped'); return null; }
  let category: string | null = textOf(d.category) || null;
  if (category && !links.categoryNames.has(category)) { c.problem('category', 'not a receipt category', 'blanked'); category = null; }
  const approval = optObj(d.approval), sentBack = optObj(d.sentBack);
  return {
    expense: {
      id, userId: linkOf(c, 'user_id', d.userId, ref.userIds, 'user'), holderName: textOf(d.holderName),
      cardId: linkOf(c, 'card_id', d.cardId, links.cardIds, 'card'), cardLabel: textOf(d.cardLabel),
      locationId: locationIdOf(c, 'location_id', d.location, ref.locationIdByName), day: expenseDay, month: textOf(d.month),
      merchant: textOf(d.merchant), cents, subtotalCents: intOf(c, 'subtotal_cents', d.subtotalCents),
      feesCents: intOf(c, 'fees_cents', d.feesCents), taxCents: intOf(c, 'tax_cents', d.taxCents), tipCents: intOf(c, 'tip_cents', d.tipCents), category, subcategory: category ? textOf(d.subcategory) : '',
      customerId: linkOf(c, 'customer_id', d.customerId, links.customerIds, 'customer'), customerName: textOf(d.customerName),
      attendees: stringsOf(d.attendees), purpose: textOf(d.purpose), note: textOf(d.note), recurring: boolOf(d.recurring),
      receiptUrl: textOf(d.receiptUrl), receiptHash: textOf(d.receiptHash), statementKind: textOf(d.statementKind), lostReason: textOf(d.lostReason), status,
      approvedById: approval ? textOf(approval.by) : null, approvedByName: approval ? textOf(approval.byName) : null,
      approvedAt: approval ? c.moment('approved_at', approval.at) : null, approvalComment: approval ? textOf(approval.comment) : null,
      approvedAs: approval && textOf(approval.as) ? textOf(approval.as) : null,
      secondApproval: optObj(d.secondApproval) ?? null, ask: optObj(d.ask) ?? null, reminders: optObj(d.reminders) ?? {},
      sentBackById: sentBack ? textOf(sentBack.by) : null, sentBackByName: sentBack ? textOf(sentBack.byName) : null,
      sentBackAt: sentBack ? c.moment('sent_back_at', sentBack.at) : null, sentBackComment: sentBack ? textOf(sentBack.comment) : null,
      createdBy: textOf(d.createdBy), addedById: d.addedById ? textOf(d.addedById) : null, voidedAt: c.moment('voided_at', d.voidedAt), voidedBy: textOf(d.voidedBy),
      voidReason: textOf(d.voidReason), ...stamp(c, d)
    },
    history: historyRows(c, id, d.history).map(h => ({ expenseId: id, position: h.position, at: h.at, by: h.by, action: h.action, changes: h.changes }))
  };
}

/** What a supplier record's links are checked against: the suppliers and POs that exist. */
export interface SupplierLinks { supplierIds: Set<string>; poIds: Set<string> }

/**
 * The rows for one supplier and its history lines, or null when it has no id. The copy and the Postgres
 * saves (src/db/suppliers/) both build rows here, so a save writes what a re-copy of MongoDB would.
 */
export function supplierRowsOf(d: Loose, problems: CopyProblem[]): { supplier: Row<typeof suppliers>; history: Row<typeof supplierHistory>[] } | null {
  const id = idOf(d._id);
  if (!id) return null;
  const c = rowConverter(problems, 'suppliers', id);
  return {
    supplier: {
      id, name: textOf(d.name), spsName: textOf(d.spsName), spsKey: textOf(d.spsKey), country: textOf(d.country),
      language: textOf(d.language) || 'en', timeZone: textOf(d.timeZone), contactName: textOf(d.contactName),
      email: textOf(d.email), phone: textOf(d.phone), notes: textOf(d.notes), active: boolOf(d.active, true),
      createdBy: textOf(d.createdBy), ...stamp(c, d)
    },
    history: historyRows(c, id, d.history)
  };
}

/** The row for one portal login, or null when it has no id or no supplier. */
export function supplierLoginRowOf(d: Loose, supplierIds: Set<string>, problems: CopyProblem[]): Row<typeof supplierLogins> | null {
  const id = idOf(d._id);
  if (!id) return null;
  const c = rowConverter(problems, 'supplier_logins', id);
  const supplierId = linkOf(c, 'supplier_id', d.supplierId, supplierIds, 'supplier');
  if (!supplierId) { c.problem('supplier_id', 'login of no supplier', 'skipped'); return null; }
  return {
    id, supplierId, name: textOf(d.name), email: textOf(d.email), password: textOf(d.password),
    language: textOf(d.language) || 'en', active: boolOf(d.active, true), sessionVersion: intOf(c, 'session_version', d.sessionVersion) ?? 0,
    linkTokenHash: textOf(d.linkTokenHash), linkExpiresAt: c.moment('link_expires_at', d.linkExpiresAt),
    loginAttempts: intOf(c, 'login_attempts', d.loginAttempts) ?? 0, lockUntil: c.moment('lock_until', d.lockUntil),
    lastLoginAt: c.moment('last_login_at', d.lastLoginAt), lastSeenAt: c.moment('last_seen_at', d.lastSeenAt),
    invitedAt: c.moment('invited_at', d.invitedAt), invitedBy: textOf(d.invitedBy), ...stamp(c, d)
  };
}

/** The rows for one PO with its lines and history, or null when it has no id or no supplier. */
export function supplierPoRowsOf(d: Loose, supplierIds: Set<string>, problems: CopyProblem[]):
  { po: Row<typeof supplierPos>; lines: Row<typeof supplierPoLines>[]; history: Row<typeof supplierPoHistory>[] } | null {
  const id = idOf(d._id);
  if (!id) return null;
  const c = rowConverter(problems, 'supplier_pos', id);
  const supplierId = linkOf(c, 'supplier_id', d.supplierId, supplierIds, 'supplier');
  if (!supplierId) { c.problem('supplier_id', 'PO of no supplier', 'skipped'); return null; }
  const lines: Row<typeof supplierPoLines>[] = [];
  list(d.lines).forEach((l, position) => {
    const x = obj(l);
    if (!x._id) { c.problem('lines.id', 'line with no id', 'skipped'); return; }
    lines.push({
      poId: id, id: textOf(x._id), position, material: textOf(x.material), thickness: textOf(x.thickness),
      finish: textOf(x.finish), slabs: intOf(c, 'lines.slabs', x.slabs) ?? 0, note: textOf(x.note)
    });
  });
  return {
    po: {
      id, poNumber: textOf(d.poNumber), supplierId, supplierName: textOf(d.supplierName), shipTo: textOf(d.shipTo),
      readyBy: c.day('ready_by', d.readyBy, ZONE), buyerId: textOf(d.buyerId), buyerName: textOf(d.buyerName),
      note: noteOf(d.note), source: pickOf(c, 'source', d.source, ['typed', 'sps'] as const, 'typed'),
      status: pickOf(c, 'status', d.status, ['open', 'closed', 'cancelled'] as const, 'open'), statusReason: textOf(d.statusReason),
      assignedAt: c.moment('assigned_at', d.assignedAt), createdBy: textOf(d.createdBy), version: intOf(c, 'version', d.__v) ?? 0,
      ...stamp(c, d)
    },
    lines,
    history: historyRows(c, id, d.history).map(h => ({ ...h }))
  };
}

const stepOf = (c: Converter, prefix: 'step1' | 'step2', v: unknown) => {
  const s = optObj(v);
  return {
    [`${prefix}Decision`]: s ? pickOf(c, `${prefix}.decision`, s.decision, ['approve', 'reject', 'retake'] as const, null) : null,
    [`${prefix}By`]: s ? textOf(s.by) : null, [`${prefix}ByName`]: s ? textOf(s.byName) : null,
    [`${prefix}At`]: s ? c.moment(`${prefix}.at`, s.at) : null, [`${prefix}Reason`]: s ? textOf(s.reason) : null
  };
};

/** The rows for one block with its bundles and history, or null when it has no id, PO or supplier. */
export function supplierBlockRowsOf(d: Loose, links: SupplierLinks, problems: CopyProblem[]):
  { block: Row<typeof supplierBlocks>; bundles: Row<typeof supplierBundles>[]; history: Row<typeof supplierBlockHistory>[] } | null {
  const id = idOf(d._id);
  if (!id) return null;
  const c = rowConverter(problems, 'supplier_blocks', id);
  const poId = linkOf(c, 'po_id', d.poId, links.poIds, 'PO'), supplierId = linkOf(c, 'supplier_id', d.supplierId, links.supplierIds, 'supplier');
  if (!poId || !supplierId) { c.problem('id', 'block of no PO or supplier', 'skipped'); return null; }
  const size = optObj(d.size);
  const bundles: Row<typeof supplierBundles>[] = [];
  list(d.bundles).forEach((b, position) => {
    const x = obj(b), unlock = optObj(x.unlock);
    if (!x._id) { c.problem('bundles.id', 'bundle with no id', 'skipped'); return; }
    bundles.push({
      blockId: id, id: textOf(x._id), position, n: intOf(c, 'bundles.n', x.n) ?? position + 1, slabs: intOf(c, 'bundles.slabs', x.slabs),
      photoUrl: textOf(x.photoUrl), photoAt: c.moment('bundles.photo_at', x.photoAt),
      previousPhotos: list(x.previousPhotos).map(p => plainJson({ url: obj(p).url ?? '', at: obj(p).at ?? null })),
      status: pickOf(c, 'bundles.status', x.status, BUNDLE_STATUSES, 'draft'), round: intOf(c, 'bundles.round', x.round) ?? 0,
      sentAt: c.moment('bundles.sent_at', x.sentAt), ...stepOf(c, 'step1', x.step1), ...stepOf(c, 'step2', x.step2),
      reason: textOf(x.reason), comment: noteOf(x.comment),
      unlockBy: unlock ? textOf(unlock.by) : null, unlockAt: unlock ? c.moment('bundles.unlock_at', unlock.at) : null,
      unlockReason: unlock ? textOf(unlock.reason) : null
    } as Row<typeof supplierBundles>);
  });
  return {
    block: {
      id, poId, poNumber: textOf(d.poNumber), supplierId, lineId: textOf(d.lineId), material: textOf(d.material),
      thickness: textOf(d.thickness), finish: textOf(d.finish), blockNumber: textOf(d.blockNumber),
      sizeLength: size ? decimalOf(size.length) : null, sizeHeight: size ? decimalOf(size.height) : null,
      sizeUnit: size ? pickOf(c, 'size_unit', size.unit, ['in', 'cm'] as const, 'in') : null,
      note: noteOf(d.note), decisionNote: noteOf(d.decisionNote), stage: textOf(d.stage) || 'draft',
      firstSentAt: c.moment('first_sent_at', d.firstSentAt), enteredBy: textOf(d.enteredBy), enteredById: textOf(d.enteredById),
      sentAt: c.moment('sent_at', d.sentAt), createdBy: textOf(d.createdBy), version: intOf(c, 'version', d.__v) ?? 0,
      ...stamp(c, d)
    },
    bundles,
    history: historyRows(c, id, d.history)
  };
}

export function cardsSuppliersRows(src: CardsSuppliersSource, ref: ReferenceIndex, cust: CustomerIndex, problems: CopyProblem[]): CardsSuppliersRows {
  const rows: CardsSuppliersRows = {
    companyCards: [], receiptCategories: [], cardExpenses: [], cardExpenseHistory: [], suppliers: [], supplierHistory: [],
    supplierLogins: [], supplierPos: [], supplierPoLines: [], supplierPoHistory: [], supplierBlocks: [], supplierBundles: [],
    supplierBlockHistory: []
  };
  const cardIds = new Set<string>(), categoryNames = new Set<string>(), supplierIds = new Set<string>(), poIds = new Set<string>();

  for (const d of src.companyCards) {
    const row = companyCardRowOf(d, ref, problems);
    if (!row) continue;
    cardIds.add(row.id);
    rows.companyCards.push(row);
  }

  for (const d of src.receiptCategories) {
    const row = receiptCategoryRowOf(d, problems);
    if (!row) continue;
    categoryNames.add(row.name);
    rows.receiptCategories.push(row);
  }

  for (const d of src.cardExpenses) {
    const built = cardExpenseRowsOf(d, ref, { cardIds, categoryNames, customerIds: cust.customerIds }, problems);
    if (!built) continue;
    rows.cardExpenses.push(built.expense);
    rows.cardExpenseHistory.push(...built.history);
  }

  for (const d of src.suppliers) {
    const built = supplierRowsOf(d, problems);
    if (!built) continue;
    supplierIds.add(built.supplier.id);
    rows.suppliers.push(built.supplier);
    rows.supplierHistory.push(...built.history);
  }

  for (const d of src.supplierLogins) {
    const row = supplierLoginRowOf(d, supplierIds, problems);
    if (row) rows.supplierLogins.push(row);
  }

  for (const d of src.supplierPos) {
    const built = supplierPoRowsOf(d, supplierIds, problems);
    if (!built) continue;
    poIds.add(built.po.id);
    rows.supplierPos.push(built.po);
    rows.supplierPoLines.push(...built.lines);
    rows.supplierPoHistory.push(...built.history);
  }

  for (const d of src.supplierBlocks) {
    const built = supplierBlockRowsOf(d, { supplierIds, poIds }, problems);
    if (!built) continue;
    rows.supplierBlocks.push(built.block);
    rows.supplierBundles.push(...built.bundles);
    rows.supplierBlockHistory.push(...built.history);
  }

  return rows;
}
