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
import { isAdminRole } from '../../utils/receiptApproval.ts';
import { formatMoney, usDate } from '../../utils/cardReceipts.ts';
import { lineStage, pacificDay, type LineStage, type StageExpense } from '../../utils/statementStage.ts';
import {
  MISSING_FROM_BY_BANK, missingFromFor, MATCH_DAYS, kindOf, lineStatus, planMatches, cardForDigits, merchantOf, statusCounts, unknownCards, daysApart, issuerLabel,
  NEAR_DAYS, isNearMatch, nearMatches, pairRefunds, REFUND_DAYS,
  type AmexLine, type Issuer, type LineKind, type LineStatus
} from '../../utils/amexStatement.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Conn = Db | Tx;
const q = (c: Conn) => c as Db;
type Actor = { id: string; name: string };

const CHUNK = 500;
const shiftDay = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86400000).toISOString().slice(0, 10);
const lock = (c: Conn) => q(c).execute(sql`select pg_advisory_xact_lock(hashtext('card_statement_check'))`);

/**
 * A charge's stand-in row an upload replaces: a Missing receipt row, or an Admin's own charge waiting for Accounting
 * with nothing on it yet (no receipt, no lost-receipt reason, no approval) — db/cardReceipts/types.ts's isChargePlaceholder.
 */
const placeholderSql = () => or(eq(cardExpenses.status, 'missing'), and(eq(cardExpenses.status, 'waiting'), eq(cardExpenses.receiptUrl, ''), eq(cardExpenses.lostReason, ''),
  isNull(cardExpenses.approvedById), sql`(${cardExpenses.secondApproval} is null or ${cardExpenses.secondApproval} = 'null'::jsonb)`));
type PlaceholderFields = { status: string | null; receiptUrl: string | null; lostReason: string | null; approvedById: string | null; secondApproval: unknown; voidedAt?: Date | null };
const isPlaceholder = (e: PlaceholderFields) => !e.voidedAt && (e.status === 'missing'
  || (e.status === 'waiting' && !e.receiptUrl && !e.lostReason && !e.approvedById && (e.secondApproval == null)));
const placeholderCols = { receiptUrl: cardExpenses.receiptUrl, lostReason: cardExpenses.lostReason, approvedById: cardExpenses.approvedById, secondApproval: cardExpenses.secondApproval };

/** Thrown to roll a preview back; carries what the check would have done. */
class Preview extends Error {
  result: unknown;
  constructor(result: unknown) { super('preview'); this.result = result; }
}

export type CheckResult = { linked: number; created: number; retired: number; cardsFound: number };

type RefundCharge = { reference: string; issuer: string; digits: string; date: string; cents: number };
/** The charges (of those given) a later refund returned, by reference (review B9). Reads the credits it needs, nothing else. */
async function refundedOf(c: Conn, charges: readonly RefundCharge[]): Promise<Set<string>> {
  if (!charges.length) return new Set();
  const days = charges.map(x => x.date).sort();
  const credits = await q(c).select({ reference: lines.reference, issuer: lines.issuer, digits: lines.digits, date: lines.day, cents: lines.cents, description: lines.description })
    .from(lines).where(and(eq(lines.kind, 'credit'), lt(lines.cents, 0), gte(lines.day, days[0]!), lt(lines.day, shiftDay(days.at(-1)!, REFUND_DAYS + 1)),
      inArray(lines.digits, [...new Set(charges.map(x => x.digits))])));
  return new Set(pairRefunds(charges, credits).keys());
}

/**
 * The check, inside a transaction the caller holds. Every charge still waiting for an upload is
 * looked at, not only the newest file's, so a receipt saved since the last upload (or a card set
 * up since) is found.
 *
 * **One bank at a time** (owner, 2026-11-24): given a `bank`, only that bank's charges are looked at and
 * only receipts on that bank's cards can answer them, so an Encore upload never reads, matches or makes
 * anything at Amex (and the other way round). A receipt is never matched to the other bank's charge by the
 * check; a person can still confirm one by hand from a Missing receipt row ("This is my receipt").
 * With no `bank` (nothing says which) every bank is checked, each on its own.
 */
async function check(tx: Conn, by: Actor, missingFrom: string | undefined, bank?: Issuer): Promise<CheckResult> {
  const result: CheckResult = { linked: 0, created: 0, retired: 0, cardsFound: 0 };
  const thisBank = bank ? eq(lines.issuer, bank) : undefined;

  // 1. Cards for lines that have none, or no upload yet (a card fixed since applies).
  const cards = await q(tx).select().from(companyCards);
  const open = await q(tx).select({ reference: lines.reference, digits: lines.digits, issuer: lines.issuer, cardId: lines.cardId }).from(lines)
    .where(and(eq(lines.kind, 'charge'), or(isNull(lines.cardId), isNull(lines.expenseId)), thisBank));
  const byDigits = new Map<string, string | null>();
  for (const l of open) {
    const key = `${l.issuer}:${l.digits}`;
    if (!byDigits.has(key)) byDigits.set(key, cardForDigits(cards, l.digits, l.issuer as Issuer)?.id ?? null);
    const cardId = byDigits.get(key) ?? null;
    if (cardId !== l.cardId) {
      await q(tx).update(lines).set({ cardId, updatedAt: new Date() }).where(eq(lines.reference, l.reference));
      if (cardId && !l.cardId) result.cardsFound += 1;
    }
  }

  // 2. Charges still waiting for an upload: none yet, or a Missing receipt row (or an Admin's waiting stand-in), or a voided one.
  const waiting = await q(tx).select({
    reference: lines.reference, issuer: lines.issuer, date: lines.day, cents: lines.cents, kind: lines.kind, cardId: lines.cardId, expenseId: lines.expenseId,
    status: cardExpenses.status, voidedAt: cardExpenses.voidedAt
  }).from(lines).leftJoin(cardExpenses, eq(cardExpenses.id, lines.expenseId))
    .where(and(eq(lines.kind, 'charge'), sql`${lines.cardId} is not null`, thisBank,
      or(isNull(lines.expenseId), placeholderSql(), sql`${cardExpenses.voidedAt} is not null`, isNull(cardExpenses.id))));
  // A charge a refund returned needs no receipt (review B9): its Missing receipt row, if one was made, is let go.
  const refunded = await refundedOf(tx, (await q(tx).select({ reference: lines.reference, issuer: lines.issuer, digits: lines.digits, date: lines.day, cents: lines.cents })
    .from(lines).where(inArray(lines.reference, waiting.map(w => w.reference)))));
  for (const w of waiting.filter(x => refunded.has(x.reference))) {
    if (w.expenseId && !w.voidedAt && (w.status === 'missing' || w.status === 'waiting')) {
      const [row] = await q(tx).select({ status: cardExpenses.status, ...placeholderCols }).from(cardExpenses).where(eq(cardExpenses.id, w.expenseId));
      if (row && isPlaceholder({ ...row, voidedAt: null })) {
        const now = new Date();
        await changeExpense(q(tx), w.expenseId, { voidedAt: now, voidedBy: by.name, voidReason: 'Charge refunded' },
          { at: now, by: by.name, action: 'voided', changes: `The ${issuerLabel(w.issuer)} charge (${w.reference}) was refunded: no receipt is needed` });
        result.retired += 1;
      }
    }
  }
  const stillWaiting = waiting.filter(w => !refunded.has(w.reference));
  waiting.length = 0;
  waiting.push(...stillWaiting);
  if (!waiting.length) return result;
  const days = waiting.map(w => w.date).sort();
  // A charge matches a receipt of the same **holder at the same bank** (a card with no holder stands for itself):
  // a card replaced at that bank keeps matching and its receipts move to the new card, but a person's receipts on
  // their other bank's card are never looked at (owner, 2026-11-24; it was any bank until then).
  const holderOf = new Map(cards.map(c => [c.id, c.userId ? `${c.userId}:${c.issuer}` : c.id]));
  const holders = new Set(waiting.map(w => holderOf.get(w.cardId!) ?? w.cardId!));
  const cardIds = cards.filter(c => holders.has(holderOf.get(c.id)!)).map(c => c.id);
  const linkedIds = waiting.map(w => w.expenseId).filter((id): id is string => Boolean(id));
  const candidates = await q(tx).select({
    id: cardExpenses.id, cardId: cardExpenses.cardId, date: cardExpenses.day, cents: cardExpenses.cents, status: cardExpenses.status,
    voidedAt: cardExpenses.voidedAt, createdAt: cardExpenses.createdAt, ...placeholderCols
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
    .map(c => ({ id: c.id, cardId: holderOf.get(c.cardId ?? '') ?? c.cardId ?? '', date: c.date, cents: c.cents,
      // An Admin's waiting stand-in counts as a Missing receipt row here: an upload replaces it, it never answers a charge.
      status: isPlaceholder(c) ? 'missing' : c.status, voided: Boolean(c.voidedAt), createdAt: c.createdAt }));
  const plan = planMatches({
    lines: waiting.map(w => ({ reference: w.reference, date: w.date, cents: w.cents, kind: w.kind as LineKind, cardId: holderOf.get(w.cardId!) ?? w.cardId, expenseId: w.expenseId, issuer: w.issuer })),
    expenses, missingFrom
  });

  // 3. Apply: links first (an upload leaves a Missing receipt row before that row is voided).
  const now = new Date();
  for (const l of plan.link) {
    await q(tx).update(lines).set({ expenseId: l.expenseId, updatedAt: now }).where(eq(lines.reference, l.reference));
    if (l.expenseId) result.linked += 1;
    // The receipt answers a charge on the person's replaced card (same bank): it now belongs to the new card.
    const line = waiting.find(w => w.reference === l.reference);
    const expense = candidates.find(c => c.id === l.expenseId);
    if (line && expense && l.expenseId && line.cardId && expense.cardId !== line.cardId) {
      const card = cards.find(c => c.id === line.cardId);
      await changeExpense(q(tx), l.expenseId, { cardId: line.cardId, cardLabel: card?.label ?? '' },
        { at: now, by: by.name, action: 'edited', changes: `Card changed to ${card?.label ?? 'the card'}: it answers a ${issuerLabel(line.issuer)} charge (${l.reference})` });
    }
  }
  for (const r of plan.retire) {
    const bank = issuerLabel(waiting.find(w => w.reference === r.reference)?.issuer ?? 'amex');
    await changeExpense(q(tx), r.expenseId, { voidedAt: now, voidedBy: by.name, voidReason: 'Receipt uploaded' },
      { at: now, by: by.name, action: 'voided', changes: `Receipt uploaded for this ${bank} charge (${r.reference})` });
    result.retired += 1;
  }
  const toCreate = plan.create.filter(ref => waitingRefs.has(ref));
  if (toCreate.length) result.created = await createMissingRows(tx, toCreate, by, now);
  return result;
}

/** One Missing receipt row per charge, for the card's holder, with Amex's day, merchant and amount. */
async function createMissingRows(tx: Conn, references: string[], by: Actor, now: Date, approvedNote?: string): Promise<number> {
  const rows = await q(tx).select({
    reference: lines.reference, issuer: lines.issuer, day: lines.day, description: lines.description, cents: lines.cents,
    cardId: companyCards.id, cardLabel: companyCards.label, userId: companyCards.userId, role: users.role,
    displayName: users.displayName, username: users.username, location: locations.name, cardLocation: companyCards.location
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
    // An Admin's own charge is never "Missing receipt": it waits for Accounting, who fills it in and approves it (receiptApproval.ts).
    const adminWaits = !approvedNote && isAdminRole(r.role);
    const doc = {
      _id: id, userId: r.userId, holderName: r.displayName || r.username || '', cardId: r.cardId, cardLabel: r.cardLabel,
      location: r.location || r.cardLocation || '', date: r.day, month: r.day.slice(0, 7), merchant: merchantOf(r.description, issuerLabel(r.issuer)), cents: r.cents,
      subtotalCents: null, taxCents: null, tipCents: null, category: '', customerId: '', customerName: '', attendees: [],
      purpose: '', note: approvedNote ?? '', recurring: false, receiptUrl: '', lostReason: '',
      status: approvedNote ? 'approved' : adminWaits ? 'waiting' : 'missing', sentBack: null,
      approval: approvedNote ? { by: by.id, byName: by.name, at: now, comment: approvedNote } : null,
      createdBy: by.name, voidedAt: null, voidedBy: '', voidReason: '',
      history: [{ at: now, by: by.name, action: 'added', changes: approvedNote ? `${approvedNote} (${issuerLabel(r.issuer)} charge ${r.reference})`
        : adminWaits ? `An Admin’s charge: waiting for Accounting (${issuerLabel(r.issuer)} charge ${r.reference})`
          : `Missing receipt: ${issuerLabel(r.issuer)} charge ${r.reference}` }],
      createdAt: now, updatedAt: now
    };
    const made = cardExpenseRowsOf(doc, ref, links, []);
    if (!made) throw new Error(`Could not make the Missing receipt row for ${issuerLabel(r.issuer)} charge ${r.reference}.`);
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
async function summaryOf(tx: Conn, references: string[], missingFrom: string | undefined, did: CheckResult) {
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
  lines: AmexLine[]; fileName: string; period: { from: string; to: string } | null; by: Actor; issuer?: Issuer;
  missingFrom?: string; preview?: boolean; beforeCheck?: (tx: Db) => Promise<void>;
}, db?: Db): Promise<StatementSummary & { importId: string; added: number; known: number }> {
  const d = db ?? await appDb();
  // Each bank has its own start day (missingFromFor); `input.missingFrom` overrides both (tests).
  const missingFrom = input.missingFrom;
  const importId = newId();
  const issuer: Issuer = input.issuer ?? 'amex';
  const references = input.lines.map(l => l.reference);
  try {
    return await d.transaction(async tx => {
      // Review B7 (2026-11-24): a real upload takes the check's lock; a preview rolls back anyway, so it takes none (every
      // receipt save waits on that lock) and gives up after 2 s if it meets a row a real upload is writing.
      if (input.preview) await q(tx).execute(sql`set local lock_timeout = '2s'`); else await lock(tx);
      const known = new Set<string>();
      for (let i = 0; i < references.length; i += 5000) {
        for (const r of await tx.select({ reference: lines.reference }).from(lines).where(inArray(lines.reference, references.slice(i, i + 5000)))) known.add(r.reference);
      }
      const now = new Date();
      // A refreshed line whose amount, card or day no longer fits the receipt it was matched to is let go: the
      // check below matches it again (or makes it Missing) instead of keeping a match that no longer holds.
      const matched = await tx.select({ reference: lines.reference, digits: lines.digits, expenseId: lines.expenseId, expDay: cardExpenses.day, expCents: cardExpenses.cents, expStatus: cardExpenses.status, expVoided: cardExpenses.voidedAt, ...placeholderCols })
        .from(lines).innerJoin(cardExpenses, eq(cardExpenses.id, lines.expenseId)).where(inArray(lines.reference, references));
      const incoming = new Map(input.lines.map(l => [l.reference, l]));
      for (const m of matched) {
        const next = incoming.get(m.reference);
        if (!next) continue;
        const daysApart = Math.abs(Date.parse(`${next.date}T00:00:00Z`) - Date.parse(`${m.expDay}T00:00:00Z`)) / 86_400_000;
        if (next.cents === m.expCents && next.digits === m.digits && daysApart <= MATCH_DAYS) continue;
        await tx.update(lines).set({ expenseId: null, cardId: null, updatedAt: now }).where(eq(lines.reference, m.reference));
        // A Missing row only ever stood for this charge as it was: it goes, and the new one is made by the check.
        if (isPlaceholder({ ...m, status: m.expStatus, voidedAt: m.expVoided })) {
          await changeExpense(q(tx), m.expenseId!, { voidedAt: now, voidedBy: input.by.name, voidReason: 'Amex charge changed' },
            { at: now, by: input.by.name, action: 'voided', changes: `The Amex charge (${m.reference}) changed in a later upload` });
        }
      }
      const values = input.lines.map(l => ({
        reference: l.reference, issuer, day: l.date, description: l.description, cardMember: l.cardMember, digits: l.digits, cents: l.cents,
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
      // Only the uploaded bank is checked: an Encore file never reads, matches or makes anything at Amex.
      const did = await check(tx, input.by, missingFrom, issuer);
      const summary = await summaryOf(tx, references, missingFrom, did);
      const result = { ...summary, importId, added: references.length - known.size, known: known.size };
      if (input.preview) throw new Preview(result);
      await tx.insert(imports).values({
        id: importId, issuer, fileName: input.fileName.slice(0, 200), periodFrom: input.period?.from ?? null, periodTo: input.period?.to ?? null,
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

/** The check alone (after a card is set up or changed): only `issuer`'s bank when given, else each bank on its own. */
export async function recheck(by: Actor, { missingFrom, beforeCheck, issuer }: { missingFrom?: string; beforeCheck?: (tx: Db) => Promise<void>; issuer?: Issuer } = {}, db?: Db) {
  const d = db ?? await appDb();
  return d.transaction(async tx => {
    await lock(tx);
    if (beforeCheck) await beforeCheck(tx as unknown as Db);
    return check(tx, by, missingFrom, issuer);
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
    // The holder's cards at the receipt's own bank (a replaced card keeps matching): only that bank's report can answer
    // it — never the other bank's (owner, 2026-11-24).
    const [mine] = await tx.select({ userId: companyCards.userId, issuer: companyCards.issuer }).from(companyCards).where(eq(companyCards.id, expense.cardId));
    const siblings = mine?.userId
      ? (await tx.select({ id: companyCards.id }).from(companyCards).where(and(eq(companyCards.userId, mine.userId), eq(companyCards.issuer, mine.issuer)))).map(r => r.id)
      : [expense.cardId];
    const found = await tx.select({ reference: lines.reference, issuer: lines.issuer, cardId: lines.cardId, day: lines.day, expenseId: lines.expenseId, status: cardExpenses.status, voidedAt: cardExpenses.voidedAt, ...placeholderCols })
      .from(lines).leftJoin(cardExpenses, eq(cardExpenses.id, lines.expenseId))
      .where(and(eq(lines.kind, 'charge'), inArray(lines.cardId, siblings), eq(lines.cents, expense.cents),
        gte(lines.day, shiftDay(expense.date, -MATCH_DAYS)), lt(lines.day, shiftDay(expense.date, MATCH_DAYS + 1)),
        or(isNull(lines.expenseId), placeholderSql(), sql`${cardExpenses.voidedAt} is not null`, isNull(cardExpenses.id))))
      .orderBy(asc(lines.day), asc(lines.reference));
    const open = found.filter(f => !f.expenseId || isPlaceholder(f) || f.voidedAt || !f.status);
    const best = open.sort((a, b) => daysApart(a.day, expense.date) - daysApart(b.day, expense.date))[0];
    if (!best) return null;
    const now = new Date();
    await tx.update(lines).set({ expenseId: expense.id, updatedAt: now }).where(eq(lines.reference, best.reference));
    if (best.cardId && best.cardId !== expense.cardId) {
      const [card] = await tx.select({ label: companyCards.label }).from(companyCards).where(eq(companyCards.id, best.cardId));
      await changeExpense(tx as unknown as Db, expense.id, { cardId: best.cardId, cardLabel: card?.label ?? '' },
        { at: now, by: by.name, action: 'edited', changes: `Card changed to ${card?.label ?? 'the card'}: it answers a ${issuerLabel(best.issuer)} charge (${best.reference})` });
    }
    if (best.expenseId && isPlaceholder(best)) {
      await changeExpense(tx as unknown as Db, best.expenseId, { voidedAt: now, voidedBy: by.name, voidReason: 'Receipt uploaded' },
        { at: now, by: by.name, action: 'voided', changes: `Receipt uploaded for this ${issuerLabel(best.issuer)} charge (${best.reference})${expense.merchant ? `: ${expense.merchant}` : ''}` });
      return best.expenseId;
    }
    return '';
  });
}

/** Why a hand match was refused (the route answers 409 with it). */
export class NearMatchError extends Error {}

export type NearReceipt = { id: string; date: string; cents: number; merchant: string; status: string; cardLabel: string; hasReceipt: boolean };
export type NearMatchList = { charge: { reference: string; issuer: Issuer; date: string; cents: number; description: string }; receipts: NearReceipt[] };

/** The charge a Missing receipt row (or an Admin's waiting stand-in) stands for, with the row; null when it stands for none. */
async function chargeOfPlaceholder(c: Conn, placeholderId: string) {
  const [row] = await q(c).select({
    reference: lines.reference, issuer: lines.issuer, day: lines.day, cents: lines.cents, description: lines.description, cardId: lines.cardId,
    userId: cardExpenses.userId, status: cardExpenses.status, voidedAt: cardExpenses.voidedAt, ...placeholderCols
  }).from(lines).innerJoin(cardExpenses, eq(cardExpenses.id, lines.expenseId))
    .where(and(eq(lines.kind, 'charge'), eq(lines.expenseId, String(placeholderId).toLowerCase())));
  return row && isPlaceholder(row) ? row : null;
}

/** The holder's receipts a charge may be (any of their cards, any bank): live, not a stand-in, answering no charge yet. */
async function openReceiptsNear(c: Conn, userId: string, day: string) {
  const cards = (await q(c).select({ id: companyCards.id }).from(companyCards).where(eq(companyCards.userId, userId))).map(r => r.id);
  if (!cards.length) return [];
  const rows = await q(c).select({
    id: cardExpenses.id, date: cardExpenses.day, cents: cardExpenses.cents, merchant: cardExpenses.merchant, status: cardExpenses.status,
    cardId: cardExpenses.cardId, cardLabel: cardExpenses.cardLabel, voidedAt: cardExpenses.voidedAt, approvedAt: cardExpenses.approvedAt, ...placeholderCols
  }).from(cardExpenses).where(and(
    inArray(cardExpenses.cardId, cards), isNull(cardExpenses.voidedAt),
    gte(cardExpenses.day, shiftDay(day, -NEAR_DAYS)), lt(cardExpenses.day, shiftDay(day, NEAR_DAYS + 1)),
    sql`not exists (select 1 from ${lines} where ${lines.expenseId} = ${cardExpenses.id})`
  ));
  return rows.filter(r => !isPlaceholder(r));
}

/**
 * Review B2 (2026-11-24): the holder's own receipts close to the charge behind a Missing receipt row (amount
 * within $5 / 10%, a week either side — `isNearMatch`), closest first. Null when the row stands for no charge.
 */
export async function nearReceiptsFor(placeholderId: string, db?: Db): Promise<NearMatchList | null> {
  const d = db ?? await appDb();
  const charge = await chargeOfPlaceholder(d, placeholderId);
  if (!charge || !charge.userId) return null;
  const open = await openReceiptsNear(d, charge.userId, charge.day);
  return {
    charge: { reference: charge.reference, issuer: charge.issuer as Issuer, date: charge.day, cents: charge.cents, description: charge.description },
    receipts: nearMatches({ date: charge.day, cents: charge.cents }, open).map(r => ({
      id: r.id, date: r.date, cents: r.cents, merchant: r.merchant, status: r.status ?? '', cardLabel: r.cardLabel ?? '',
      hasReceipt: Boolean(r.receiptUrl || r.lostReason)
    }))
  };
}

/**
 * "This is my receipt": the charge behind a Missing receipt row is answered by a receipt the holder already
 * saved. In one transaction under the check's lock: the charge points at the receipt, which takes the bank's
 * day and total (what a matched receipt keeps — matchedChangeProblem) and the charge's card; a changed total
 * takes back any approval given (the PUT's rule), so an Approved one waits again; the Missing receipt row is
 * voided. Everything is checked again here; a refusal throws NearMatchError and changes nothing.
 * `holderId`: the caller, who must be the row's holder.
 */
export async function matchReceiptToCharge(placeholderId: string, receiptId: string, holderId: string, by: Actor, db?: Db): Promise<{ voided: string; receiptId: string }> {
  const d = db ?? await appDb();
  return d.transaction(async tx => {
    await lock(tx);
    const charge = await chargeOfPlaceholder(tx, placeholderId);
    if (!charge || charge.userId !== holderId) throw new NearMatchError('This charge already has its receipt, or isn’t yours.');
    const receipt = (await openReceiptsNear(tx, holderId, charge.day)).find(r => r.id === String(receiptId).toLowerCase());
    if (!receipt) throw new NearMatchError('That receipt can’t be used for this charge: it already answers one, was voided, or isn’t yours.');
    if (!isNearMatch({ date: charge.day, cents: charge.cents }, receipt)) throw new NearMatchError('That receipt is too far from this charge in amount or date to be the same purchase.');
    const now = new Date();
    const bank = issuerLabel(charge.issuer);
    await q(tx).update(lines).set({ expenseId: receipt.id, updatedAt: now }).where(eq(lines.reference, charge.reference));

    const totalChanged = receipt.cents !== charge.cents;
    const hadApproval = Boolean(receipt.approvedById || receipt.approvedAt || (receipt.secondApproval != null && receipt.secondApproval !== 'null'));
    const clears = totalChanged && hadApproval;
    const card = charge.cardId && charge.cardId !== receipt.cardId
      ? (await q(tx).select({ label: companyCards.label }).from(companyCards).where(eq(companyCards.id, charge.cardId)))[0] : undefined;
    const changes = [
      `Matched by hand to ${bank} charge ${charge.reference}`,
      totalChanged ? `total ${formatMoney(receipt.cents)} → ${formatMoney(charge.cents)}` : '',
      receipt.date !== charge.day ? `date ${usDate(receipt.date)} → ${usDate(charge.day)}` : '',
      card ? `card ${receipt.cardLabel} → ${card.label}` : '',
      clears ? 'approvals cleared' : ''
    ].filter(Boolean).join(' · ');
    await changeExpense(q(tx), receipt.id, {
      date: charge.day, month: charge.day.slice(0, 7), cents: charge.cents,
      ...(card ? { cardId: charge.cardId, cardLabel: card.label } : {}),
      ...(clears ? { approval: null, secondApproval: null, ...(receipt.status === 'approved' ? { status: 'waiting' } : {}) } : {})
    }, { at: now, by: by.name, action: 'edited', changes });
    await changeExpense(q(tx), placeholderId, { voidedAt: now, voidedBy: by.name, voidReason: 'Receipt uploaded' },
      { at: now, by: by.name, action: 'voided', changes: `Receipt already uploaded for this ${bank} charge (${charge.reference}): ${receipt.merchant}` });
    return { voided: String(placeholderId).toLowerCase(), receiptId: receipt.id };
  });
}

/**
 * Which of these expenses answer a line on a bank statement (an upload matched to its charge, or the Missing
 * receipt row made for it) — the Expenses tab's "matched with the statement" (2026-11-24). In chunks, so a long
 * list stays under the parameter limit.
 */
export async function linkedExpenseIds(ids: readonly string[], db?: Db): Promise<Set<string>> {
  const clean = [...new Set(ids.map((i) => String(i ?? '').toLowerCase()).filter(Boolean))];
  const found = new Set<string>();
  if (!clean.length) return found;
  const d = db ?? await appDb();
  for (let i = 0; i < clean.length; i += 2000) {
    const rows = await d.select({ id: lines.expenseId }).from(lines).where(inArray(lines.expenseId, clean.slice(i, i + 2000)));
    for (const r of rows) if (r.id) found.add(String(r.id).toLowerCase());
  }
  return found;
}

/** The Amex charge an expense answers, if any. */
export async function linkedLine(expenseId: string, db?: Db): Promise<string | null> {
  const d = db ?? await appDb();
  const [row] = await d.select({ reference: lines.reference }).from(lines).where(eq(lines.expenseId, String(expenseId).toLowerCase()));
  return row?.reference ?? null;
}

export type StatementLineView = {
  reference: string; issuer: Issuer; date: string; description: string; cardMember: string; digits: string; cents: number; kind: LineKind;
  amexCategory: string; cityState: string; cardId: string | null; cardLabel: string; holderId: string; holderName: string;
  expenseId: string | null; expenseStatus: string | null; status: LineStatus;
  /** The Status column (statementStage.ts): the receipt's approval stage, or what the line is. */
  stage: LineStage;
  /** The cardholder's home branch ('' = none), for the branch pill beside the card. */
  branch: string;
};

/** A stored approval ({ by, byName, at, … } jsonb, or the expense's approved_* columns) as the stage rule reads it. */
const decisionOf = (v: unknown) => {
  const d = v && typeof v === 'object' ? v as { byName?: unknown; at?: unknown } : null;
  return d ? { byName: String(d.byName ?? ''), at: (d.at as string | Date | null) ?? '' } : null;
};
const askOf = (v: unknown) => {
  const a = v && typeof v === 'object' ? v as { toName?: unknown; answeredAt?: unknown } : null;
  return a ? { toName: String(a.toName ?? ''), answeredAt: (a.answeredAt as string | Date | null) ?? null } : null;
};

async function linesWhere(c: Conn, where: ReturnType<typeof and>, missingFrom?: string): Promise<StatementLineView[]> {
  const rows = await q(c).select({
    l: lines, cardLabel: companyCards.label, cardLocation: companyCards.location, holderId: companyCards.userId,
    displayName: users.displayName, username: users.username, holderRole: users.role, homeLocation: locations.name,
    expenseStatus: cardExpenses.status, expenseVoided: cardExpenses.voidedAt,
    expenseReceipt: cardExpenses.receiptUrl, expenseLost: cardExpenses.lostReason,
    expenseDay: cardExpenses.day, expenseCents: cardExpenses.cents, expenseHolder: cardExpenses.holderName,
    approvedByName: cardExpenses.approvedByName, approvedAt: cardExpenses.approvedAt, approvedById: cardExpenses.approvedById,
    secondApproval: cardExpenses.secondApproval, ask: cardExpenses.ask, sentBackAt: cardExpenses.sentBackAt
  }).from(lines)
    .leftJoin(companyCards, eq(companyCards.id, lines.cardId))
    .leftJoin(users, eq(users.id, companyCards.userId))
    .leftJoin(locations, eq(locations.id, users.homeLocationId))
    .leftJoin(cardExpenses, eq(cardExpenses.id, lines.expenseId))
    .where(where)
    .orderBy(desc(lines.day), asc(lines.reference));
  const refunded = await refundedOf(c, rows.filter(r => r.l.kind === 'charge').map(r => ({ reference: r.l.reference, issuer: r.l.issuer, digits: r.l.digits, date: r.l.day, cents: r.l.cents })));
  const today = pacificDay(new Date());
  return rows.map(r => {
    const kind = r.l.kind as LineKind;
    const status = lineStatus({
      kind, date: r.l.day, cardId: r.l.cardId, expenseStatus: r.expenseStatus ?? null, expenseVoided: Boolean(r.expenseVoided),
      hasReceipt: Boolean(r.expenseReceipt || r.expenseLost), refunded: refunded.has(r.l.reference), issuer: r.l.issuer
    }, missingFrom);
    const holderName = r.displayName || r.username || '';
    const expense: StageExpense | null = r.expenseStatus && !r.expenseVoided ? {
      day: r.expenseDay ?? '', status: r.expenseStatus, cents: Number(r.expenseCents) || 0, holderRole: r.holderRole ?? '',
      holderName: r.expenseHolder || holderName,
      approval: r.approvedById == null ? null : { byName: r.approvedByName ?? '', at: r.approvedAt ?? '' },
      secondApproval: decisionOf(r.secondApproval), ask: askOf(r.ask), sentBackAt: r.sentBackAt ?? null
    } : null;
    return {
      reference: r.l.reference, issuer: r.l.issuer as Issuer, date: r.l.day, description: r.l.description, cardMember: r.l.cardMember, digits: r.l.digits, cents: r.l.cents,
      kind, amexCategory: r.l.amexCategory, cityState: r.l.cityState, cardId: r.l.cardId, cardLabel: r.cardLabel ?? '',
      holderId: r.holderId ?? '', holderName,
      expenseId: r.l.expenseId, expenseStatus: r.expenseStatus ?? null,
      status,
      stage: lineStage(status, { date: r.l.day }, expense, today),
      branch: r.homeLocation || r.cardLocation || ''
    };
  });
}

/** One month of lines (by Amex's day), the cards no line could be placed on, how many receipts are still missing, and the uploads. */
export async function statementView(month: string, { missingFrom }: { missingFrom?: string } = {}, db?: Db) {
  const d = db ?? await appDb();
  const from = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const to = new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 10);
  const [monthLines, noCard, missingNow, missingUnheld, uploads] = await Promise.all([
    linesWhere(d, and(gte(lines.day, from), lt(lines.day, to)), missingFrom),
    d.select({ issuer: lines.issuer, digits: lines.digits, cardMember: lines.cardMember, cents: lines.cents, kind: lines.kind, date: lines.day, cardId: lines.cardId })
      .from(lines).where(isNull(lines.cardId)),
    d.select({ issuer: lines.issuer, n: sql<number>`count(*)::int`, cents: sql<number>`coalesce(sum(${lines.cents}), 0)::bigint` }).from(lines)
      .innerJoin(cardExpenses, eq(cardExpenses.id, lines.expenseId))
      .where(and(eq(cardExpenses.status, 'missing'), isNull(cardExpenses.voidedAt)))
      .groupBy(lines.issuer),
    // Charges on a card nobody holds yet have no Missing row to count, but they are still missing (shown as such).
    d.select({ issuer: lines.issuer, n: sql<number>`count(*)::int`, cents: sql<number>`coalesce(sum(${lines.cents}), 0)::bigint` }).from(lines)
      .innerJoin(companyCards, eq(companyCards.id, lines.cardId))
      .where(and(isNull(companyCards.userId), isNull(lines.expenseId), eq(lines.kind, 'charge'),
        missingFrom ? gte(lines.day, missingFrom)
          : or(and(eq(lines.issuer, 'amex'), gte(lines.day, MISSING_FROM_BY_BANK.amex)), and(eq(lines.issuer, 'encore'), gte(lines.day, MISSING_FROM_BY_BANK.encore)))))
      .groupBy(lines.issuer),
    d.select().from(imports).orderBy(desc(imports.at)).limit(20)
  ]);
  // Still-missing receipts, in all and by bank (the Statements tab shows one bank at a time).
  const stillMissing = (bank?: string) => [...missingNow, ...missingUnheld].filter(r => !bank || r.issuer === bank)
    .reduce((t, r) => ({ count: t.count + Number(r.n), cents: t.cents + Number(r.cents) }), { count: 0, cents: 0 });
  return {
    lines: monthLines,
    unknownCards: unknownCards(noCard.map(l => ({ ...l, kind: l.kind as LineKind }))),
    missingNow: stillMissing(),
    missingByBank: { amex: stillMissing('amex'), encore: stillMissing('encore') },
    imports: uploads.map(i => ({
      id: i.id, issuer: i.issuer as Issuer, fileName: i.fileName, periodFrom: i.periodFrom, periodTo: i.periodTo, lines: i.lines, added: i.added,
      chargesCents: i.chargesCents, summary: i.summary, byName: i.byName, at: i.at
    })),
    missingFrom: missingFrom ?? MISSING_FROM_BY_BANK.amex,
    missingFromByBank: missingFrom ? { amex: missingFrom, encore: missingFrom } : { ...MISSING_FROM_BY_BANK }
  };
}

/** The card IDs and people the Cards not set up step needs: which digits already have a card. */
export async function cardsByDigits(digits: string[], db?: Db, issuer: Issuer = 'amex') {
  const d = db ?? await appDb();
  const cards = await d.select().from(companyCards);
  return new Map(digits.map(x => [x, cardForDigits(cards, x, issuer)]));
}

/** The Card Member name Amex prints for each account's last 5 digits (the most common one across the uploads). */
export async function amexNamesByDigits(db?: Db, issuer: Issuer = 'amex'): Promise<Map<string, string>> {
  const d = db ?? await appDb();
  const rows = await d.select({ digits: lines.digits, name: lines.cardMember, n: sql<number>`count(*)::int` })
    .from(lines).where(and(sql`${lines.cardMember} <> ''`, eq(lines.issuer, issuer))).groupBy(lines.digits, lines.cardMember);
  const best = new Map<string, { name: string; n: number }>();
  for (const r of rows) {
    const cur = best.get(r.digits);
    if (!cur || r.n > cur.n) best.set(r.digits, { name: r.name.replace(/\s+/g, ' '), n: r.n });
  }
  return new Map([...best].map(([k, v]) => [k, v.name]));
}
