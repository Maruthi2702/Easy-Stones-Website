import type { Loose } from '../types/records.ts';
/**
 * Match/pipeline pieces for the sales dashboard's rollups (GET
 * /api/dashboard/stats, /visits, /resources in server.ts). Moved out of
 * server.ts so they can be imported — by those routes, and by anything that
 * needs to check a pipeline change returns what it did before.
 *
 * getAggregationDateRef / getAggregationRangeMatch / getFollowUpRangeMatch are
 * the original helpers, unchanged. rangePrefilter, followUpDatePrefilter and
 * slimForUnwind are new: they run before $unwind so a rollup stops unpacking
 * every visit of every customer on every request.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const LAST_DAYS: Record<string, number> = { '7days': 7, '30days': 30, '90days': 90 };
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/**
 * The dashboard's time range (its header, every tab) as the first and last
 * moment it covers — null for an open end. `1day` is the target day; 7 / 30 /
 * 90 days count back from `now`; `year` is from January 1; `custom` is
 * `from`–`to` (YYYY-MM-DD, whole days, either may be missing, either way
 * round); `all` or anything unknown is open both ends.
 */
export const dashboardRangeDates = (
  timeRange: unknown,
  { now = new Date(), startOfTargetDay = null, endOfTargetDay = null, from, to }:
    { now?: Date; startOfTargetDay?: Date | null; endOfTargetDay?: Date | null; from?: unknown; to?: unknown } = {}
): { startDate: Date | null; endDate: Date | null } => {
  const range = String(timeRange || '');
  if (range === '1day') return { startDate: startOfTargetDay, endDate: endOfTargetDay };
  if (LAST_DAYS[range]) return { startDate: new Date(now.getTime() - LAST_DAYS[range] * DAY_MS), endDate: null };
  if (range === 'year') return { startDate: new Date(now.getFullYear(), 0, 1), endDate: null };
  if (range === 'custom') {
    let a = isDay(from) ? from : '';
    let b = isDay(to) ? to : '';
    if (a && b && a > b) [a, b] = [b, a];
    return {
      startDate: a ? new Date(`${a}T00:00:00.000Z`) : null,
      endDate: b ? new Date(`${b}T23:59:59.999Z`) : null
    };
  }
  return { startDate: null, endDate: null };
};

export const getAggregationDateRef = (prefix: string) => ({
  $cond: [
    { $eq: [{ $type: `$${prefix}.date` }, "string"] },
    `$${prefix}.date`,
    {
      $cond: [
        { $eq: [{ $type: `$${prefix}.createdAt` }, "date"] },
        { $dateToString: { format: "%Y-%m-%d", date: `$${prefix}.createdAt` } },
        { $ifNull: [{ $substr: [{ $ifNull: [`$${prefix}.createdAt`, ""] }, 0, 10] }, ""] }
      ]
    }
  ]
});

export const getAggregationRangeMatch = (start: Date | null | undefined, end: Date | null | undefined, prefix: string, additionalMatch: Loose = {}) => {
  const startStr = start?.toISOString().split('T')[0];
  const endStr = end?.toISOString().split('T')[0];
  const dateRef = getAggregationDateRef(prefix);
  const conds = [];

  // Add additional matches (like createdBy)
  for (const [key, value] of Object.entries(additionalMatch)) {
    // Use $toString for ID fields to be safe with mixed types
    if (key.includes('createdBy') || key.includes('uploadedBy')) {
      conds.push({ $eq: [{ $toString: `$${key}` }, value] });
    } else {
      conds.push({ $eq: [`$${key}`, value] });
    }
  }

  if (startStr) conds.push({ $gte: [dateRef, startStr] });
  if (endStr) conds.push({ $lte: [dateRef, endStr] });

  return conds.length > 0 ? { $expr: { $and: conds } } : {};
};

export const getFollowUpRangeMatch = (start: Date | null | undefined, end: Date | null | undefined, additionalMatch: Loose = {}) => {
  const startStr = start?.toISOString().split('T')[0];
  const endStr = end?.toISOString().split('T')[0];
  const conds = [];

  // Add additional matches
  for (const [key, value] of Object.entries(additionalMatch)) {
    if (key.includes('createdBy') || key.includes('uploadedBy')) {
      conds.push({ $eq: [{ $toString: `$${key}` }, value] });
    } else {
      conds.push({ $eq: [`$${key}`, value] });
    }
  }

  // Expression to normalize followUpDate to a YYYY-MM-DD string format on the fly
  const followUpDateExpr = {
    $cond: [
      { $eq: [{ $type: "$visits.followUpDate" }, "date"] },
      { $dateToString: { format: "%Y-%m-%d", date: "$visits.followUpDate" } },
      { $ifNull: ["$visits.followUpDate", ""] }
    ]
  };

  // Include if follow-up date is set OR if follow-up notes exist
  conds.push({
    $or: [
      { $and: [{ $ne: [followUpDateExpr, ""] }, { $ne: [followUpDateExpr, null] }] },
      { $and: [{ $ne: ["$visits.followUp", ""] }, { $ne: ["$visits.followUp", null] }] },
      { $and: [{ $ne: ["$visits.nextAction", ""] }, { $ne: ["$visits.nextAction", null] }] }
    ]
  });

  // Optimised Follow-up Logic:
  // 1. If a range is provided, we filter based on followUpDate.
  if (startStr) {
    if (startStr === endStr) {
      // "Today" (or single day) filter on dashboard: show follow-ups for that day OR anytime in the future
      // This excludes past/overdue follow-ups to keep the "Today" view focused on current/upcoming work.
      conds.push({
        $and: [
          { $ne: [followUpDateExpr, ""] },
          { $ne: [followUpDateExpr, null] },
          { $gte: [followUpDateExpr, startStr] }
        ]
      });
    } else {
      // Other ranges (7 days, 30 days, or "All"): Show items in range PLUS overdue items.
      const todayStr = new Date().toISOString().split('T')[0];
      const referenceToday = (startStr < todayStr) ? todayStr : startStr;

      conds.push({
        $or: [
          { $gte: [followUpDateExpr, startStr] },
          { $lt: [followUpDateExpr, referenceToday] },
          // Items without a date (notes only) are included in the "All" or relative views
          { $eq: [followUpDateExpr, ""] },
          { $eq: [followUpDateExpr, null] }
        ]
      });
    }
  }

  return { $expr: { $and: conds } };
};

const ymd = (d: Loose) => d?.toISOString().split('T')[0];

/**
 * A document-level $match to put before `$unwind: "$<prefix>"`, so only
 * customers holding at least one entry that could be in range get unpacked.
 * Uses the same string comparison getAggregationRangeMatch applies after the
 * unwind, so it keeps every entry that match would; an entry whose date isn't
 * a string (that match falls back to createdAt for it) is always let through
 * for the match after the unwind to decide. Null when there's no range.
 */
export const rangePrefilter = (start: Date | null | undefined, end: Date | null | undefined, prefix: string) => {
  const startStr = ymd(start);
  const endStr = ymd(end);
  if (!startStr && !endStr) return null;
  const range: Loose = {};
  if (startStr) range.$gte = startStr;
  if (endStr) range.$lte = endStr;
  return { $match: { [prefix]: { $elemMatch: { $or: [{ date: range }, { date: { $not: { $type: 'string' } } }] } } } };
};

/** Same idea for "follow-up due on `dayStr`": a string equal to it, or a Date for the match after to format. */
export const followUpDatePrefilter = (dayStr: unknown) => ({
  $match: { visits: { $elemMatch: { $or: [{ followUpDate: dayStr }, { followUpDate: { $type: 'date' } }] } } }
});

/**
 * Trim each customer to what a rollup over `<prefix>` reads, before `$unwind`
 * copies the whole document once per entry. A customer with photos stored
 * inline in its visits was being copied megabytes at a time per visit, for
 * output that never includes the photos. `extra` keeps more customer fields
 * (the Resources list shows the customer's city).
 */
export const slimForUnwind = (prefix: string, extra: string[] = []) => [
  { $project: { company: 1, contactName: 1, location: 1, ...Object.fromEntries(extra.map((f) => [f, 1])), [prefix]: 1 } },
  { $unset: `${prefix}.image` }
];

/**
 * Whose entries a dashboard rollup keeps: `people` is visiblePeople /
 * narrowPeople from teamScope.js (by the REP's branch) — ALL_PEOPLE ('*') or a
 * Set of user ids. A visit belongs to whoever logged it (`createdBy`); a
 * resource to whoever uploaded it (`uploadedBy`, else `createdBy`), the same
 * person canModifyVisit checks.
 */
const authorOf = (prefix: string) => (prefix === 'resources'
  ? { $toString: { $ifNull: ['$resources.uploadedBy', '$resources.createdBy'] } }
  : { $toString: `$${prefix}.createdBy` });

/** A $match for after `$unwind: "$<prefix>"` keeping only `people`'s entries; null for everyone. */
export const peopleMatch = (people: '*' | ReadonlySet<string>, prefix: string) =>
  (people === '*' ? null : { $match: { $expr: { $in: [authorOf(prefix), [...people]] } } });

/**
 * A document-level $match for before the unwind: only customers holding an
 * entry by one of `people`. `idVariants` turns an id into every form it may be
 * stored in (string and ObjectId) — the exact check is peopleMatch's. Null for
 * everyone.
 */
export const peoplePrefilter = (people: '*' | ReadonlySet<string>, prefix: string, idVariants: (id: string) => unknown[] = (id) => [id]) => {
  if (people === '*') return null;
  const values = [...people].flatMap(idVariants);
  const fields = prefix === 'resources' ? ['uploadedBy', 'createdBy'] : ['createdBy'];
  return { $match: { $or: fields.map((f) => ({ [`${prefix}.${f}`]: { $in: values } })) } };
};
