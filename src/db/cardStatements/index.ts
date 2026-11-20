/**
 * Credit Card Receipts → the Amex check: the data layer (rules in src/utils/amexStatement.ts).
 * Postgres only (src/db/schema/cardStatements.ts). It writes card expenses too — the Missing
 * receipt rows — straight into Postgres with the copy's own row builder, which is where Credit
 * Card Receipts has lived since its cutover (2026-11-14); the route refuses to run otherwise.
 *
 * Every check runs in one transaction under one advisory lock, so two uploads (or an upload and
 * a receipt saved at that moment) never match the same charge twice:
 *   1. lines with no card yet, or no upload yet, get the card their digits name;
 *   2. planMatches decides what each charge points at;
 *   3. a Missing receipt row is made for each charge from the start day with no upload, and a
 *      Missing receipt row an upload now covers is voided (its history says why).
 */
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { appDb } from '../appDb.ts';
import { newId } from '../ids.ts';
import { cardStatementLines as lines, cardStatementImports as imports } from '../schema/cardStatements.ts';
import { cardExpenses, cardExpenseHistory, companyCards } from '../schema/cardsSuppliers.ts';
import { users, locations } from '../schema/reference.ts';
import { cardExpenseRowsOf } from '../copy/cardsSuppliersRows.ts';
import { referenceIndexOf } from '../customers/writes/coreSupport.postgres.ts';
import { changeExpense } from '../cardReceipts/postgres.ts';
import {
  MISSING_FROM, MATCH_DAYS, kindOf, lineStatus, planMatches, cardForDigits, merchantOf, statusCounts, unknownCards, daysApart,
  type AmexLine, type LineKind, type LineStatus
} from '../../utils/amexStatement.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Conn = Db | Tx;
const q = (c: Conn) => c as Db;
type Actor = { id: string; name: string };

const CHUNK = 500;
const shiftDay = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86400000).toISOString().slice(0, 10);
const lock = (c: Conn) => q(c).execute(sql`select pg_advisory_xact_lock(hashtext('card_statement_check'))`);

/** Thrown to roll a preview back; carries what the check would have done. */
class Preview extends Error {
  result: unknown;
  constructor(result: unknown) { super('preview'); this.result = result; }
}

export type CheckResult = { linked: number; created: number; retired: number; cardsFound: number };

/**
 * The check, inside a transaction the caller holds. Every charge still waiting for an upload is
 * looked at, not only the newest file's, so a receipt saved since the last upload (or a card set
 * up since) is found.
 */
async function check(tx: Conn, by: Actor, missingFrom: string): Promise<CheckResult> {
  const result: CheckResult = { linked: 0, created: 0, retired: 0, cardsFound: 0 };

  // 1. Cards for lines that have none, or no upload yet (a card fixed since applies).
  const cards = await q(tx).select().from(companyCards);
  const open = await q(tx).select({ reference: lines.reference, digits: lines.digits, cardId: lines.cardId }).from(lines)
    .where(and(eq(lines.kind, 'charge'), or(isNull(lines.cardId), isNull(lines.expenseId))));
  const byDigits = new Map<string, string | null>();
  for (const l of open) {
    if (!byDigits.has(l.digits)) byDigits.set(l.digits, cardForDigits(cards, l.digits)?.id ?? null);
    const cardId = byDigits.get(l.digits) ?? null;
    if (cardId !== l.cardId) {
      await q(tx).update(lines).set({ cardId, updatedAt: new Date() }).where(eq(lines.reference, l.reference));
      if (cardId && !l.cardId) result.cardsFound += 1;
    }
  }

  // 2. Charges still waiting for an upload: none yet, or a Missing receipt row, or a voided one.
  const waiting = await q(tx).select({
    reference: lines.reference, date: lines.day, cents: lines.cents, kind: lines.kind, cardId: lines.cardId, expenseId: lines.expenseId,
    status: cardExpenses.status, voidedAt: cardExpenses.voidedAt
  }).from(lines).leftJoin(cardExpenses, eq(cardExpenses.id, lines.expenseId))
    .where(and(eq(lines.kind, 'charge'), sql`${lines.cardId} is not null`,
      or(isNull(lines.expenseId), eq(cardExpenses.status, 'missing'), sql`${cardExpenses.voidedAt} is not null`, isNull(cardExpenses.id))));
  if (!waiting.length) return result;
  const days = waiting.map(w => w.date).sort();
  const cardIds = [...new Set(waiting.map(w => w.cardId!))];
  const linkedIds = waiting.map(w => w.expenseId).filter((id): id is string => Boolean(id));
  const candidates = await q(tx).select({
    id: cardExpenses.id, cardId: cardExpenses.cardId, date: cardExpenses.day, cents: cardExpenses.cents, status: cardExpenses.status,
    voidedAt: cardExpenses.voidedAt, createdAt: cardExpenses.createdAt
  }).from(cardExpenses).where(or(
    and(inArray(cardExpenses.cardId, cardIds), gte(cardExpenses.day, shiftDay(days[0]!, -MATCH_DAYS)), lt(cardExpenses.day, shiftDay(days.at(-1)!, MATCH_DAYS + 1))),
    linkedIds.length ? inArray(cardExpenses.id, linkedIds) : undefined
  ));
  // An upload already answering a charge outside this set is taken.
  const elsewhere = new Set((await q(tx).select({ id: lines.expenseId }).from(lines)
    .where(and(sql`${lines.expenseId} is not null`, candidates.length ? inArray(lines.expenseId, candidates.map(c => c.id)) : sql`false`)))
    .map(r => r.id!));
  const waitingRefs = new Set(waiting.map(w => w.reference));
  const linkedHere = new Set(linkedIds);
  const expenses = candidates
    .filter(c => !elsewhere.has(c.id) || linkedHere.has(c.id))
    .map(c => ({ id: c.id, cardId: c.cardId ?? '', date: c.date, cents: c.cents, status: c.status, voided: Boolean(c.voidedAt), createdAt: c.createdAt }));
  const plan = planMatches({
    lines: waiting.map(w => ({ reference: w.reference, date: w.date, cents: w.cents, kind: w.kind as LineKind, cardId: w.cardId, expenseId: w.expenseId })),
    expenses, missingFrom
  });

  // 3. Apply: links first (an upload leaves a Missing receipt row before that row is voided).
  const now = new Date();
  for (const l of plan.link) {
    await q(tx).update(lines).set({ expenseId: l.expenseId, updatedAt: now }).where(eq(lines.reference, l.reference));
    if (l.expenseId) result.linked += 1;
  }
  for (const r of plan.retire) {
    await changeExpense(q(tx), r.expenseId, { voidedAt: now, voidedBy: by.name, voidReason: 'Receipt uploaded' },
      { at: now, by: by.name, action: 'voided', changes: `Receipt uploaded for this Amex charge (${r.reference})` });
    result.retired += 1;
  }
  const toCreate = plan.create.filter(ref => waitingRefs.has(ref));
  if (toCreate.length) result.created = await createMissingRows(tx, toCreate, by, now);
  return result;
}

/** One Missing receipt row per charge, for the card's holder, with Amex's day, merchant and amount. */
async function createMissingRows(tx: Conn, references: string[], by: Actor, now: Date, approvedNote?: string): Promise<number> {
  const rows = await q(tx).select({
    reference: lines.reference, day: lines.day, description: lines.description, cents: lines.cents,
    cardId: companyCards.id, cardLabel: companyCards.label, userId: companyCards.userId,
    displayName: users.displayName, username: users.username, location: locations.name
  }).from(lines)
    .innerJoin(companyCards, eq(companyCards.id, lines.cardId))
    .leftJoin(users, eq(users.id, companyCards.userId))
    .leftJoin(locations, eq(locations.id, users.homeLocationId))
    .where(and(inArray(lines.reference, references), sql`${companyCards.userId} is not null`));
  // A card with no holder yet has no one to ask: its charges wait, and get their rows once it's assigned.
  if (!rows.length) return 0;
  const ref = await referenceIndexOf(q(tx));
  const links = { cardIds: new Set(rows.map(r => r.cardId)), categoryNames: new Set<string>(), customerIds: new Set<string>() };
  const built = rows.map(r => {
    const id = newId();
    const doc = {
      _id: id, userId: r.userId, holderName: r.displayName || r.username || '', cardId: r.cardId, cardLabel: r.cardLabel,
      location: r.location || '', date: r.day, month: r.day.slice(0, 7), merchant: merchantOf(r.description), cents: r.cents,
      subtotalCents: null, taxCents: null, tipCents: null, category: '', customerId: '', customerName: '', attendees: [],
      purpose: '', note: approvedNote ?? '', recurring: false, receiptUrl: '', lostReason: '',
      status: approvedNote ? 'approved' : 'missing', sentBack: null,
      approval: approvedNote ? { by: by.id, byName: by.name, at: now, comment: approvedNote } : null,
      createdBy: by.name, voidedAt: null, voidedBy: '', voidReason: '',
      history: [{ at: now, by: by.name, action: 'added', changes: approvedNote ? `${approvedNote} (Amex charge ${r.reference})` : `Missing receipt: Amex charge ${r.reference}` }],
      createdAt: now, updatedAt: now
    };
    const made = cardExpenseRowsOf(doc, ref, links, []);
    if (!made) throw new Error(`Could not make the Missing receipt row for Amex charge ${r.reference}.`);
    return { reference: r.reference, ...made };
  });
  for (let i = 0; i < built.length; i += CHUNK) {
    const part = built.slice(i, i + CHUNK);
    await q(tx).insert(cardExpenses).values(part.map(b => b.expense));
    const history = part.flatMap(b => b.history);
    if (history.length) await q(tx).insert(cardExpenseHistory).values(history);
  }
  for (const b of built) await q(tx).update(lines).set({ expenseId: b.expense.id, updatedAt: now }).where(eq(lines.reference, b.reference));
  return built.length;
}

/**
 * Stopgap (owner, 2026-11-20): the charges of a month from before the check started get an Approved
 * expense each, for their card's holder, so they show in Expenses and the line reads "Receipt uploaded".
 * Only charges on a set-up card with no expense yet; a card not set up has no holder to give one to.
 * `preview` counts and writes nothing.
 */
export async function approveMonthWithoutReceipts(month: string, by: Actor, { preview = false }: { preview?: boolean } = {}, db?: Db) {
  const d = db ?? await appDb();
  const from = `${month}-01`;
  const to = new Date(Date.parse(`${from}T00:00:00Z`) + 32 * 86400000).toISOString().slice(0, 7) + '-01';
  return d.transaction(async tx => {
    await lock(tx);
    const open = await q(tx).select({ reference: lines.reference, cents: lines.cents }).from(lines)
      .where(and(eq(lines.kind, 'charge'), sql`${lines.cardId} is not null`, isNull(lines.expenseId), gte(lines.day, from), lt(lines.day, to)));
    const all = await q(tx).select({ n: sql<number>`count(*)::int` }).from(lines).where(and(eq(lines.kind, 'charge'), gte(lines.day, from), lt(lines.day, to)));
    const noCard = await q(tx).select({ n: sql<number>`count(*)::int` }).from(lines)
      .where(and(eq(lines.kind, 'charge'), isNull(lines.cardId), gte(lines.day, from), lt(lines.day, to)));
    const result = { charges: all[0]?.n ?? 0, toAdd: open.length, cents: open.reduce((t, r) => t + r.cents, 0), cardNotSetUp: noCard[0]?.n ?? 0, added: 0 };
    if (preview || !open.length) return result;
    result.added = await createMissingRows(tx, open.map(o => o.reference), by, new Date(), 'Added from the Amex statement without a receipt (before the check started)');
    return result;
  });
}

/** What an upload found: its own lines' statuses, the cards it couldn't place, what the check did. */
async function summaryOf(tx: Conn, references: string[], missingFrom: string, did: CheckResult) {
  const mine = await linesWhere(tx, inArray(lines.reference, references), missingFrom);
  const counts = statusCounts(mine);
  return {
    lines: mine.length,
    counts,
    charges: mine.filter(l => l.kind === 'charge').length,
    chargesCents: mine.filter(l => l.cents > 0).reduce((s, l) => s + l.cents, 0),
    unknownCards: unknownCards(mine.map(l => ({ ...l, cardId: l.cardId }))),
    check: did
  };
}
export type StatementSummary = Awaited<ReturnType<typeof summaryOf>>;

/**
 * Saves an upload's lines (new ones added, known ones refreshed with what Amex says now; the
 * card and the match are kept) and runs the check. `preview` does it all and rolls back.
 */
export async function importStatement(input: {
  lines: AmexLine[]; fileName: string; period: { from: string; to: string } | null; by: Actor;
  missingFrom?: string; preview?: boolean; beforeCheck?: (tx: Db) => Promise<void>;
}, db?: Db): Promise<StatementSummary & { importId: string; added: number; known: number }> {
  const d = db ?? await appDb();
  const missingFrom = input.missingFrom ?? MISSING_FROM;
  const importId = newId();
  const references = input.lines.map(l => l.reference);
  try {
    return await d.transaction(async tx => {
      await lock(tx);
      const known = new Set<string>();
      for (let i = 0; i < references.length; i += 5000) {
        for (const r of await tx.select({ reference: lines.reference }).from(lines).where(inArray(lines.reference, references.slice(i, i + 5000)))) known.add(r.reference);
      }
      const now = new Date();
      const values = input.lines.map(l => ({
        reference: l.reference, day: l.date, description: l.description, cardMember: l.cardMember, digits: l.digits, cents: l.cents,
        kind: kindOf(l), amexCategory: l.amexCategory, extended: l.extended, appearsAs: l.appearsAs, address: l.address,
        cityState: l.cityState, zip: l.zip, country: l.country, firstImportId: importId, lastImportId: importId, createdAt: now, updatedAt: now
      }));
      for (let i = 0; i < values.length; i += CHUNK) {
        await tx.insert(lines).values(values.slice(i, i + CHUNK)).onConflictDoUpdate({
          target: lines.reference,
          set: {
            day: sql`excluded.day`, description: sql`excluded.description`, cardMember: sql`excluded.card_member`, digits: sql`excluded.digits`,
            cents: sql`excluded.cents`, kind: sql`excluded.kind`, amexCategory: sql`excluded.amex_category`, extended: sql`excluded.extended`,
            appearsAs: sql`excluded.appears_as`, address: sql`excluded.address`, cityState: sql`excluded.city_state`, zip: sql`excluded.zip`,
            country: sql`excluded.country`, lastImportId: sql`excluded.last_import_id`, updatedAt: sql`excluded.updated_at`
          }
        });
      }
      if (input.beforeCheck) await input.beforeCheck(tx as unknown as Db);
      const did = await check(tx, input.by, missingFrom);
      const summary = await summaryOf(tx, references, missingFrom, did);
      const result = { ...summary, importId, added: references.length - known.size, known: known.size };
      if (input.preview) throw new Preview(result);
      await tx.insert(imports).values({
        id: importId, fileName: input.fileName.slice(0, 200), periodFrom: input.period?.from ?? null, periodTo: input.period?.to ?? null,
        lines: references.length, added: result.added, chargesCents: summary.chargesCents,
        summary: { counts: summary.counts, check: did, unknownCards: summary.unknownCards.length },
        byId: input.by.id, byName: input.by.name, at: now
      });
      return result;
    });
  } catch (err) {
    if (err instanceof Preview) return err.result as Awaited<ReturnType<typeof importStatement>>;
    throw err;
  }
}

/** The check alone (after a card is set up from the Statements tab). */
export async function recheck(by: Actor, { missingFrom = MISSING_FROM, beforeCheck }: { missingFrom?: string; beforeCheck?: (tx: Db) => Promise<void> } = {}, db?: Db) {
  const d = db ?? await appDb();
  return d.transaction(async tx => {
    await lock(tx);
    if (beforeCheck) await beforeCheck(tx as unknown as Db);
    return check(tx, by, missingFrom);
  });
}

/**
 * A receipt just saved by its cardholder: if it's the upload a charge was waiting for (same
 * card, exact amount, at most 2 days apart, nearest first), the charge points at it and the
 * Missing receipt row made for that charge is voided. Returns that row's id, '' when there was
 * none to void, or null when it answers no charge.
 */
export async function claimUpload(expense: { id: string; cardId: string; date: string; cents: number; merchant?: string }, by: Actor, db?: Db): Promise<string | null> {
  const d = db ?? await appDb();
  return d.transaction(async tx => {
    await lock(tx);
    if (await linkedLine(expense.id, tx as unknown as Db)) return null;
    const found = await tx.select({ reference: lines.reference, day: lines.day, expenseId: lines.expenseId, status: cardExpenses.status, voidedAt: cardExpenses.voidedAt })
      .from(lines).leftJoin(cardExpenses, eq(cardExpenses.id, lines.expenseId))
      .where(and(eq(lines.kind, 'charge'), eq(lines.cardId, expense.cardId), eq(lines.cents, expense.cents),
        gte(lines.day, shiftDay(expense.date, -MATCH_DAYS)), lt(lines.day, shiftDay(expense.date, MATCH_DAYS + 1)),
        or(isNull(lines.expenseId), eq(cardExpenses.status, 'missing'), sql`${cardExpenses.voidedAt} is not null`, isNull(cardExpenses.id))))
      .orderBy(asc(lines.day), asc(lines.reference));
    const open = found.filter(f => !f.expenseId || f.status === 'missing' || f.voidedAt || !f.status);
    const best = open.sort((a, b) => daysApart(a.day, expense.date) - daysApart(b.day, expense.date))[0];
    if (!best) return null;
    const now = new Date();
    await tx.update(lines).set({ expenseId: expense.id, updatedAt: now }).where(eq(lines.reference, best.reference));
    if (best.expenseId && best.status === 'missing' && !best.voidedAt) {
      await changeExpense(tx as unknown as Db, best.expenseId, { voidedAt: now, voidedBy: by.name, voidReason: 'Receipt uploaded' },
        { at: now, by: by.name, action: 'voided', changes: `Receipt uploaded for this Amex charge (${best.reference})${expense.merchant ? `: ${expense.merchant}` : ''}` });
      return best.expenseId;
    }
    return '';
  });
}

/** The Amex charge an expense answers, if any. */
export async function linkedLine(expenseId: string, db?: Db): Promise<string | null> {
  const d = db ?? await appDb();
  const [row] = await d.select({ reference: lines.reference }).from(lines).where(eq(lines.expenseId, String(expenseId).toLowerCase()));
  return row?.reference ?? null;
}

export type StatementLineView = {
  reference: string; date: string; description: string; cardMember: string; digits: string; cents: number; kind: LineKind;
  amexCategory: string; cityState: string; cardId: string | null; cardLabel: string; holderId: string; holderName: string;
  expenseId: string | null; expenseStatus: string | null; status: LineStatus;
};

async function linesWhere(c: Conn, where: ReturnType<typeof and>, missingFrom: string): Promise<StatementLineView[]> {
  const rows = await q(c).select({
    l: lines, cardLabel: companyCards.label, holderId: companyCards.userId, displayName: users.displayName, username: users.username,
    expenseStatus: cardExpenses.status, expenseVoided: cardExpenses.voidedAt
  }).from(lines)
    .leftJoin(companyCards, eq(companyCards.id, lines.cardId))
    .leftJoin(users, eq(users.id, companyCards.userId))
    .leftJoin(cardExpenses, eq(cardExpenses.id, lines.expenseId))
    .where(where)
    .orderBy(desc(lines.day), asc(lines.reference));
  return rows.map(r => {
    const kind = r.l.kind as LineKind;
    return {
      reference: r.l.reference, date: r.l.day, description: r.l.description, cardMember: r.l.cardMember, digits: r.l.digits, cents: r.l.cents,
      kind, amexCategory: r.l.amexCategory, cityState: r.l.cityState, cardId: r.l.cardId, cardLabel: r.cardLabel ?? '',
      holderId: r.holderId ?? '', holderName: r.displayName || r.username || '',
      expenseId: r.l.expenseId, expenseStatus: r.expenseStatus ?? null,
      status: lineStatus({ kind, date: r.l.day, cardId: r.l.cardId, expenseStatus: r.expenseStatus ?? null, expenseVoided: Boolean(r.expenseVoided),
        unassigned: Boolean(r.l.cardId) && !r.holderId }, missingFrom)
    };
  });
}

/** One month of lines (by Amex's day), the cards no line could be placed on, how many receipts are still missing, and the uploads. */
export async function statementView(month: string, { missingFrom = MISSING_FROM }: { missingFrom?: string } = {}, db?: Db) {
  const d = db ?? await appDb();
  const from = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const to = new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 10);
  const [monthLines, noCard, missingNow, uploads] = await Promise.all([
    linesWhere(d, and(gte(lines.day, from), lt(lines.day, to)), missingFrom),
    d.select({ digits: lines.digits, cardMember: lines.cardMember, cents: lines.cents, kind: lines.kind, date: lines.day, cardId: lines.cardId })
      .from(lines).where(isNull(lines.cardId)),
    d.select({ n: sql<number>`count(*)::int`, cents: sql<number>`coalesce(sum(${lines.cents}), 0)::bigint` }).from(lines)
      .innerJoin(cardExpenses, eq(cardExpenses.id, lines.expenseId))
      .where(and(eq(cardExpenses.status, 'missing'), isNull(cardExpenses.voidedAt))),
    d.select().from(imports).orderBy(desc(imports.at)).limit(20)
  ]);
  return {
    lines: monthLines,
    unknownCards: unknownCards(noCard.map(l => ({ ...l, kind: l.kind as LineKind }))),
    missingNow: { count: missingNow[0]?.n ?? 0, cents: Number(missingNow[0]?.cents ?? 0) },
    imports: uploads.map(i => ({
      id: i.id, fileName: i.fileName, periodFrom: i.periodFrom, periodTo: i.periodTo, lines: i.lines, added: i.added,
      chargesCents: i.chargesCents, summary: i.summary, byName: i.byName, at: i.at
    })),
    missingFrom
  };
}

/** The card IDs and people the Cards not set up step needs: which digits already have a card. */
export async function cardsByDigits(digits: string[], db?: Db) {
  const d = db ?? await appDb();
  const cards = await d.select().from(companyCards);
  return new Map(digits.map(x => [x, cardForDigits(cards, x)]));
}
