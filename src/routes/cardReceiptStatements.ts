import type { Request, RequestHandler, Response } from 'express';
import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import * as staffData from '../db/staff/index.ts';
import * as pgCards from '../db/cardReceipts/postgres.ts';
import * as statements from '../db/cardStatements/index.ts';
import { appDb, areaOn } from '../db/appDb.ts';
import type { Db } from '../db/copy/plan.ts';
import { newId } from '../db/ids.ts';
import { runWorkbookParse } from '../utils/runWorkbookParse.ts';
import { CARD_RECEIPTS, isMonth, suggestCardLabel } from '../utils/cardReceipts.ts';
import { MISSING_FROM, suggestHolder, issuerLabel, type Issuer } from '../utils/amexStatement.ts';
import type { Loose } from '../types/records.ts';

/**
 * Credit Card Receipts → Statements: the weekly Amex and Encore check (rules src/utils/amexStatement.ts and
 * src/utils/encoreStatement.ts, data src/db/cardStatements/). Everything needs the Amex check switch
 * (`check_amex_statements`). `issuer` ('amex' by default, or 'encore') names the bank of an upload or a card.
 *
 *   GET  /?month=YYYY-MM   that month's Amex lines with their status, the cards not set up, how
 *                          many receipts are still missing, the uploads, and the people to pick from
 *   POST /preview          multipart `file` (+ `cards`, JSON [{ digits, userId }]): what an upload
 *                          would do — nothing is kept
 *   POST /import           the same, kept: new lines added, known ones refreshed, cards set up,
 *                          charges matched, Missing receipt rows made
 *   POST /cards            { digits, userId }: set up one card from the Statements tab, then check again
 *
 *   app.use('/api/card-receipts/statements', createCardReceiptStatementsRouter({ authenticate }));
 *
 * Postgres only: answers 503 while Credit Card Receipts is on MongoDB.
 */

type ReqUser = { id?: string; _id?: string; username?: string; displayName?: string; permissions?: string[] };
const userOf = (req: Request) => ((req as Request & { user?: ReqUser }).user || {}) as ReqUser;
const actorOf = (req: Request) => ({ id: String(userOf(req).id || userOf(req)._id || ''), name: userOf(req).displayName || userOf(req).username || '' });
const nameOf = (u: { displayName?: string | null; username?: string | null }) => u.displayName || u.username || '';
const homeOf = (u: { location?: string | null; assignedLocations?: string[] | null }) =>
  u.location || (u.assignedLocations || []).find((l) => l && l !== '*') || '';
const MAX_FILE = 10 * 1024 * 1024;

type CardPick = { digits: string; userId: string; replace?: boolean };
const issuerOf = (raw: unknown): Issuer => (raw === 'encore' ? 'encore' : 'amex');
class CardProblem extends Error {
  digits: string;
  constructor(message: string, digits: string) { super(message); this.digits = digits; }
}

/** Staff who can hold a card (not the shared admin login), with the card they already have. */
async function peopleList() {
  const [people, cards] = await Promise.all([
    staffData.findUsers({}, { select: 'username displayName role location assignedLocations isActive', sort: { displayName: 1 } }),
    pgCards.listCards(await appDb())
  ]);
  const cardsOf = (issuer: string) => new Map(cards.filter((c) => c.active !== false && (c.issuer === 'encore') === (issuer === 'encore')).map((c) => [String(c.userId), String(c.label)]));
  const amexCard = cardsOf('amex'), encoreCard = cardsOf('encore');
  return people.filter((p) => p.username !== 'admin').map((p) => ({
    id: String(p._id), name: nameOf(p), role: p.role || '', location: homeOf(p), active: p.isActive !== false,
    card: amexCard.get(String(p._id)) || '', encoreCard: encoreCard.get(String(p._id)) || ''
  }));
}

/** `cards` from a form field (JSON) or a body: [{ digits, userId }], one per digits. */
function picksOf(raw: unknown): CardPick[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    try { list = JSON.parse(raw); } catch { throw new CardProblem('The cards picked could not be read.', ''); }
  }
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > 200) throw new CardProblem('The cards picked could not be read.', '');
  const seen = new Set<string>();
  return list.flatMap((p) => {
    const digits = String((p as Loose)?.digits ?? '').replace(/\D/g, '').slice(-5);
    const userId = String((p as Loose)?.userId ?? '').trim();
    if (!digits || !userId || seen.has(digits)) return [];
    seen.add(digits);
    return [{ digits, userId, replace: (p as Loose)?.replace === true }];
  });
}

/** Sets up each picked card inside the check's transaction: one active card per person, a card ID like MARU92069. */
const setUpCards = (picks: CardPick[], by: string, mayReplace: boolean, issuer: Issuer = 'amex') => async (tx: Db) => {
  const has = issuer === 'encore' ? 'an Encore card,' : 'card';
  for (const p of picks) {
    if (!mongoose.isValidObjectId(p.userId)) throw new CardProblem('Choose the cardholder again.', p.digits);
    const person = await staffData.userById(p.userId, { select: 'username displayName isActive' });
    if (!person) throw new CardProblem('That person isn’t on the staff list.', p.digits);
    const existing = (await statements.cardsByDigits([p.digits], tx, issuer)).get(p.digits);
    if (existing) throw new CardProblem(`Card …${p.digits} is already set up (${existing.label}).`, p.digits);
    const label = suggestCardLabel(nameOf(person), p.digits);
    const clash = await pgCards.activeCardClash(tx, p.userId, label, null, issuer);
    if (clash && clash.userId === p.userId) {
      // A replaced card: Amex gives it new digits under the same Card Member name. Only when that name is this person's
      // does the old card step aside (deactivated, history kept); otherwise it stays a refusal.
      if (!p.replace) throw new CardProblem(`${nameOf(person)} already has ${has} ${clash.label}. Confirm the replacement to deactivate it, or deactivate it under Cards first.`, p.digits);
      if (!mayReplace) throw new CardProblem('Replacing a card needs someone who manages company cards (accounting or an admin).', p.digits);
      const said = (await statements.amexNamesByDigits(tx, issuer)).get(p.digits) || '';
      if (!said || !suggestHolder([{ id: p.userId, name: nameOf(person), active: true }], said)) {
        throw new CardProblem(`${nameOf(person)} already has ${has} ${clash.label}. One card per person: deactivate it under Cards first.`, p.digits);
      }
      await pgCards.changeCard(tx, String(clash._id ?? clash.id), { active: false, updatedBy: by });
    } else if (clash) {
      throw new CardProblem(`Another active card is called ${label}.`, p.digits);
    }
    await pgCards.addCard(tx, newId(), { userId: p.userId, issuer, lastDigits: p.digits, label, active: true, updatedBy: by });
  }
};

const canManageCards = (req: Request) => (userOf(req).permissions || []).includes(CARD_RECEIPTS.MANAGE_CARDS);

export default function createCardReceiptStatementsRouter({ authenticate }: { authenticate: RequestHandler }) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE, files: 1 } });
  const allowed = (req: Request, res: Response, next: () => void) => {
    if (!(userOf(req).permissions || []).includes(CARD_RECEIPTS.STATEMENTS)) return res.status(403).json({ message: 'Your role can’t run the Amex check.' });
    if (areaOn('card_receipts') !== 'postgres') return res.status(503).json({ message: 'The Amex check needs Credit Card Receipts on Postgres.' });
    next();
  };
  const cardError = (res: Response, err: unknown) => {
    if (err instanceof CardProblem) return res.status(409).json({ message: err.message, digits: err.digits }), true;
    return false;
  };

  router.get('/', authenticate, allowed, async (req: Request, res: Response) => {
    const month = String(req.query.month ?? '');
    if (!isMonth(month)) return res.status(400).json({ message: 'Provide a month as YYYY-MM.' });
    try {
      const [view, people] = await Promise.all([statements.statementView(month), peopleList()]);
      res.json({
        ...view,
        unknownCards: view.unknownCards.map((c) => ({ ...c, suggestedUserId: suggestHolder(people, c.cardMember)?.id ?? '' })),
        people
      });
    } catch (error) {
      console.error('[card-statements] view failed:', error);
      res.status(500).json({ message: 'Could not load the Amex check.' });
    }
  });

  const run = (preview: boolean) => (req: Request, res: Response) => {
    upload.single('file')(req, res, async (uploadErr) => {
      if (uploadErr) {
        const tooBig = (uploadErr as { code?: string }).code === 'LIMIT_FILE_SIZE';
        return res.status(400).json({ message: tooBig ? 'That file is over 10 MB.' : 'The file could not be read.' });
      }
      const issuer = issuerOf(req.body?.issuer);
      if (!req.file) return res.status(400).json({ message: issuer === 'encore' ? 'Choose Encore’s transactions export (.xlsx).' : 'Choose Amex’s activity export (.xlsx).' });
      let read;
      try {
        read = await runWorkbookParse(issuer === 'encore' ? 'encore-activity' : 'amex-activity', req.file.buffer);
      } catch (err) {
        return res.status(400).json({ message: err instanceof Error ? err.message : 'The file could not be read.' });
      }
      if (read.problems.length) {
        return res.status(400).json({ message: read.problems[0], problems: read.problems.slice(0, 20), more: Math.max(0, read.problems.length - 20) });
      }
      try {
        const by = actorOf(req);
        const picks = picksOf(req.body?.cards);
        const [result, people] = await Promise.all([
          statements.importStatement({
            lines: read.lines, fileName: String(req.file.originalname || ''), period: read.period, by, issuer,
            preview, beforeCheck: picks.length ? setUpCards(picks, by.name, canManageCards(req), issuer) : undefined
          }),
          peopleList()
        ]);
        res.json({
          ...result,
          period: read.period,
          missingFrom: MISSING_FROM,
          unknownCards: result.unknownCards.map((c) => ({ ...c, suggestedUserId: suggestHolder(people, c.cardMember)?.id ?? '' })),
          people,
          preview
        });
      } catch (err) {
        if (cardError(res, err)) return;
        // A preview that met a real upload mid-write (lock_timeout): nothing is wrong, look again in a moment.
        const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
        if (preview && code === '55P03') return res.status(409).json({ message: 'Another upload is being saved. Try again in a moment.' });
        console.error('[card-statements] import failed:', err);
        res.status(500).json({ message: preview ? 'Could not check the file.' : 'The upload failed. Nothing was changed.' });
      }
    });
  };
  router.post('/preview', authenticate, allowed, run(true));
  router.post('/import', authenticate, allowed, run(false));

  router.post('/cards', authenticate, allowed, async (req: Request, res: Response) => {
    let picks: CardPick[];
    try { picks = picksOf([req.body || {}]); } catch (err) { return void cardError(res, err); }
    if (!picks.length) return res.status(400).json({ message: 'Choose the cardholder.' });
    try {
      const by = actorOf(req);
      const check = await statements.recheck(by, { beforeCheck: setUpCards(picks, by.name, canManageCards(req), issuerOf(req.body?.issuer)) });
      res.json({ check });
    } catch (err) {
      if (cardError(res, err)) return;
      console.error('[card-statements] card set-up failed:', err);
      res.status(500).json({ message: 'Could not set up the card. Nothing was changed.' });
    }
  });

  return router;
}
