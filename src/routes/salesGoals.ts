import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import * as staffData from '../db/staff/index.ts';
import * as goalsData from '../db/salesGoals/index.ts';
import { teamOfRequest } from '../services/teamDirectory.ts';
import { displayNameOf, isSalesRep } from '../utils/salesReps.ts';
import { workLocationsOf } from '../utils/teamScope.ts';
import { asOfIn, canSetGoals, canViewTeamGoals, mayChangeGoalsOf, mayViewGoalsOf, readGoalMonths } from '../utils/salesGoals.ts';
import type { GoalMonths } from '../utils/salesGoals.ts';
import type { Loose } from '../types/records.ts';

/**
 * Sales goals (src/utils/salesGoals.ts), for Dashboard → Sales Visits → Goals.
 *
 *   GET /api/sales-goals?year=2026
 *     → { year, years, asOf, canSet, canViewTeam, people: [{ id, name, branch, you, inactive, goalCents[12], salesCents[12] }] }
 *   PUT /api/sales-goals/:userId?year=2026   { months: [12 dollar amounts or blanks] }  (needs Set goals)
 *     → { person }
 *
 * The caller always gets their own row. Anyone else's comes only with Team goals (or Set goals)
 * and only for people on their team (teamScope: by the rep's branch) — a rep never receives a
 * teammate's goals, sales against them or the team total; the screen has nothing to hide.
 * Sales are the SPS monthly report added up over the customers the rep owns
 * (src/db/salesGoals: salesByRep). Money is whole cents; a month with no goal is null.
 */
type StaffRequest = Request & { user?: Loose; userId?: string };

const staffDirectory = () => staffData.findUsers({}, { select: '_id username displayName role location assignedLocations isActive' });

const validYear = (raw: unknown, fallback: number) => {
  const n = raw === undefined || raw === '' ? fallback : Number(raw);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
};

const blank = (): GoalMonths => Array(12).fill(null);

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
      const [goals, sales, years] = await Promise.all([goalsData.goalsFor(year, ids), goalsData.salesByRep(year), goalsData.goalYears(asOf.year)]);
      const people = allowed
        .map((u) => entry(u, viewer.id, goals.get(String(u._id)), sales.get(String(u._id))))
        // A deactivated person shows only if the year holds a goal or sales for them.
        .filter((p) => !p.inactive || p.goalCents.some((g) => g != null) || p.salesCents.some((s) => s != null))
        .sort((a, b) => Number(b.you) - Number(a.you) || a.branch.localeCompare(b.branch) || a.name.localeCompare(b.name));
      res.json({ year, years, asOf, canSet: canSetGoals(viewer), canViewTeam: canViewTeamGoals(viewer), people });
    } catch (error) {
      console.error('Sales goals failed:', error);
      res.status(500).json({ message: 'Could not load sales goals.' });
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
      const [goals, sales] = await Promise.all([goalsData.goalsFor(year, [userId]), goalsData.salesByRep(year)]);
      res.json({ person: entry(target, viewer.id, goals.get(userId), sales.get(userId)) });
    } catch (error) {
      console.error('Setting sales goals failed:', error);
      res.status(500).json({ message: 'Could not save the goals. Nothing was changed.' });
    }
  });

  return router;
}
