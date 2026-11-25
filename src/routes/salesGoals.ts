import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import * as staffData from '../db/staff/index.ts';
import * as goalsData from '../db/salesGoals/index.ts';
import { teamOfRequest } from '../services/teamDirectory.ts';
import { displayNameOf, isSalesRep } from '../utils/salesReps.ts';
import { workLocationsOf } from '../utils/teamScope.ts';
import { readRepSalesSheet } from '../utils/repSales.ts';
import { asOfIn, canSetGoals, canViewTeamGoals, matchReportReps, mayChangeGoalsOf, mayViewGoalsOf, readGoalMonths, sumCents } from '../utils/salesGoals.ts';
import type { GoalMonths } from '../utils/salesGoals.ts';
import type { Loose } from '../types/records.ts';

/**
 * Sales goals (src/utils/salesGoals.ts), for Dashboard → Sales Visits → Goals.
 *
 *   GET /api/sales-goals?year=2026
 *     → { year, years, asOf, canSet, canViewTeam, people: [{ id, name, branch, you, inactive, goalCents[12], salesCents[12] }] }
 *   POST /api/sales-goals/sales/preview { rows }   → what the rep file holds and which names match staff (writes nothing)
 *   POST /api/sales-goals/sales/import  { rows, fileName, exportedOn, links }  → replaces that year (needs Set goals)
 *   PUT /api/sales-goals/:userId?year=2026   { months: [12 dollar amounts or blanks] }  (needs Set goals)
 *     → { person }
 *
 * The caller always gets their own row. Anyone else's comes only with Team goals (or Set goals)
 * and only for people on their team (teamScope: by the rep's branch) — a rep never receives a
 * teammate's goals, sales against them or the team total; the screen has nothing to hide.
 * Sales are the SPS monthly report added up by each row's **Primary Sales Person** — not by who owns the
 * customer today, which changes often (src/db/salesGoals: salesByReportRep; names matched to staff by
 * matchReportReps, and `unmatchedReps` lists the ones that match nobody, for people who set goals).
 * Money is whole cents; a month with no goal is null.
 */
type StaffRequest = Request & { user?: Loose; userId?: string };

const staffDirectory = () => staffData.findUsers({}, { select: '_id username displayName role location assignedLocations isActive' });

const validYear = (raw: unknown, fallback: number) => {
  const n = raw === undefined || raw === '' ? fallback : Number(raw);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
};

const blank = (): GoalMonths => Array(12).fill(null);

/** Report names → staff ids: by name (matchReportReps), then the links a person made by hand, which win. */
async function matchNames(staff: Loose[], names: string[]) {
  const reps = staff.filter(isSalesRep);
  const matched = matchReportReps(reps, names);
  const known = new Set(reps.map((u) => String(u._id)));
  for (const [key, userId] of await goalsData.repLinks()) if (known.has(userId)) matched.set(key, userId);
  return matched;
}

/**
 * The year's sales by staff id, from the report's Primary Sales Person on each row, plus the report
 * names that match no staff member (so a director can see what isn't being counted).
 */
async function salesOfYear(year: number, staff: Loose[]) {
  const bucket = await goalsData.salesByReportRep(year);
  const matched = await matchNames(staff, [...bucket.values()].map((b) => b.name));
  const byId = new Map<string, (number | null)[]>();
  const unmatched: { name: string; salesCents: number }[] = [];
  for (const [key, b] of bucket) {
    const id = matched.get(key);
    if (!id) { unmatched.push({ name: b.name, salesCents: sumCents(b.months) }); continue; }
    const months = byId.get(id) ?? blank();
    b.months.forEach((c, i) => { if (c != null) months[i] = (months[i] ?? 0) + c; });
    byId.set(id, months);
  }
  unmatched.sort((a, b) => b.salesCents - a.salesCents);
  return { byId, unmatched };
}

const entry = (u: Loose, me: string, goals?: GoalMonths, sales?: (number | null)[]) => ({
  id: String(u._id),
  name: displayNameOf(u),
  branch: workLocationsOf(u)[0] ?? '',
  you: String(u._id) === me,
  inactive: u.isActive === false,
  goalCents: goals ?? blank(),
  salesCents: sales ?? blank()
});

export default function createSalesGoalsRouter({ authenticate, requireSalesPage }: { authenticate: RequestHandler; requireSalesPage: RequestHandler }) {
  const router = Router();
  const viewerOf = (req: StaffRequest) => ({ id: String(req.userId || ''), permissions: req.user?.permissions });

  router.get('/', authenticate, requireSalesPage, async (req: StaffRequest, res) => {
    try {
      const asOf = asOfIn(new Date());
      const year = validYear(req.query.year, asOf.year);
      if (!year) return res.status(400).json({ message: 'Pick a year between 2000 and 2100.' });
      const viewer = viewerOf(req);
      const team = await teamOfRequest(req);
      const staff = await staffDirectory();
      // Everyone this person may see, who is a rep (or is themselves).
      const allowed = staff.filter((u) => mayViewGoalsOf(viewer, u._id, team) && (isSalesRep(u) || String(u._id) === viewer.id));
      const ids = allowed.map((u) => String(u._id));
      const [goals, sales, years] = await Promise.all([goalsData.goalsFor(year, ids), salesOfYear(year, staff), goalsData.goalYears(asOf.year)]);
      const people = allowed
        .map((u) => entry(u, viewer.id, goals.get(String(u._id)), sales.byId.get(String(u._id))))
        // A deactivated person shows only if the year holds a goal or sales for them.
        .filter((p) => !p.inactive || p.goalCents.some((g) => g != null) || p.salesCents.some((s) => s != null))
        .sort((a, b) => Number(b.you) - Number(a.you) || a.branch.localeCompare(b.branch) || a.name.localeCompare(b.name));
      // Names on the report that match no staff member: only for someone who sets goals (it is the whole company's sales).
      res.json({ year, years, asOf, canSet: canSetGoals(viewer), canViewTeam: canViewTeamGoals(viewer), people, unmatchedReps: canSetGoals(viewer) ? sales.unmatched : [] });
    } catch (error) {
      console.error('Sales goals failed:', error);
      res.status(500).json({ message: 'Could not load sales goals.' });
    }
  });

  // The rep file ("Sales by Primary Sales Rep - Monthly"): preview writes nothing, import replaces its year.
  const readFile = (req: StaffRequest, res: Parameters<RequestHandler>[1]) => {
    if (!canSetGoals(viewerOf(req))) { res.status(403).json({ message: 'Your role can’t import sales.' }); return null; }
    const sheet = readRepSalesSheet(req.body?.rows);
    if (sheet.problems.length) { res.status(400).json({ message: sheet.problems[0], problems: sheet.problems.slice(0, 20) }); return null; }
    return sheet;
  };

  router.post('/sales/preview', authenticate, requireSalesPage, async (req: StaffRequest, res) => {
    const sheet = readFile(req, res);
    if (!sheet) return;
    try {
      const staff = await staffDirectory();
      const matched = await matchNames(staff, sheet.entries.map((e) => e.name));
      const nameOf = new Map(staff.map((u) => [String(u._id), displayNameOf(u)]));
      const total = (e: { cents: (number | null)[] }) => sumCents(e.cents);
      const rows = sheet.entries.map((e) => ({ name: e.name, key: e.key, cents: total(e), userId: matched.get(e.key) ?? '' }));
      const last = await goalsData.lastRepImport(sheet.year);
      res.json({
        year: sheet.year, reps: sheet.entries.length, totalCents: sheet.totalCents, noRepCents: sheet.noRepCents,
        matched: rows.filter((r) => r.userId).map((r) => ({ ...r, userName: nameOf.get(r.userId) ?? '' })).sort((a, b) => b.cents - a.cents),
        unmatched: rows.filter((r) => !r.userId).sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents)),
        earlier: last ? { importedAt: last.importedAt, reps: last.reps } : null
      });
    } catch (error) {
      console.error('Rep sales preview failed:', error);
      res.status(500).json({ message: 'Could not check the file.' });
    }
  });

  router.post('/sales/import', authenticate, requireSalesPage, async (req: StaffRequest, res) => {
    const sheet = readFile(req, res);
    if (!sheet) return;
    try {
      const staff = await staffDirectory();
      const reps = new Set(staff.filter(isSalesRep).map((u) => String(u._id)));
      const links: Record<string, string> = {};
      for (const [key, id] of Object.entries((req.body?.links ?? {}) as Record<string, unknown>)) {
        if (typeof id === 'string' && reps.has(id.toLowerCase()) && sheet.entries.some((e) => e.key === key)) links[key] = id.toLowerCase();
      }
      const by = String(req.user?.username || req.user?.name || '');
      const done = await goalsData.replaceRepYear({
        year: sheet.year, entries: sheet.entries, totalCents: sheet.totalCents, noRepCents: sheet.noRepCents,
        fileName: String(req.body?.fileName || '').slice(0, 200), exportedOn: String(req.body?.exportedOn || '').slice(0, 60), by, links
      });
      const matched = await matchNames(staff, sheet.entries.map((e) => e.name));
      const unmatched = sheet.entries.filter((e) => !matched.has(e.key)).map((e) => ({ name: e.name, cents: sumCents(e.cents) }))
        .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
      res.json({ year: sheet.year, ...done, totalCents: sheet.totalCents, matched: sheet.entries.length - unmatched.length, unmatched });
    } catch (error) {
      console.error('Rep sales import failed:', error);
      res.status(500).json({ message: 'The sales import failed. Nothing was changed.' });
    }
  });

  router.put('/:userId', authenticate, requireSalesPage, async (req: StaffRequest, res) => {
    try {
      const asOf = asOfIn(new Date());
      const year = validYear(req.query.year, asOf.year);
      if (!year) return res.status(400).json({ message: 'Pick a year between 2000 and 2100.' });
      const userId = String(req.params.userId || '').toLowerCase();
      if (!/^[0-9a-f]{24}$/i.test(userId)) return res.status(404).json({ message: 'Person not found.' });
      const viewer = viewerOf(req);
      if (!canSetGoals(viewer)) return res.status(403).json({ message: 'Your role can’t set sales goals.' });
      const team = await teamOfRequest(req);
      if (!mayChangeGoalsOf(viewer, userId, team)) return res.status(403).json({ message: 'You can set goals only for people on your team.' });
      const target = (await staffDirectory()).find((u) => String(u._id) === userId);
      if (!target || !isSalesRep(target)) return res.status(404).json({ message: 'Person not found.' });
      const months = readGoalMonths(req.body?.months);
      if (!months.ok) return res.status(400).json({ message: months.message });
      const by = String(req.user?.username || req.user?.name || '');
      await goalsData.saveGoals({ userId: userId.toLowerCase(), year, cents: months.cents, by });
      const [goals, sales] = await Promise.all([goalsData.goalsFor(year, [userId]), salesOfYear(year, await staffDirectory())]);
      res.json({ person: entry(target, viewer.id, goals.get(userId), sales.byId.get(userId)) });
    } catch (error) {
      console.error('Setting sales goals failed:', error);
      res.status(500).json({ message: 'Could not save the goals. Nothing was changed.' });
    }
  });

  return router;
}
