/**
 * Match/pipeline pieces for the sales dashboard's rollups (GET
 * /api/dashboard/stats, /visits, /resources in server.js). Moved out of
 * server.js so they can be imported — by those routes, and by anything that
 * needs to check a pipeline change returns what it did before.
 *
 * getAggregationDateRef / getAggregationRangeMatch / getFollowUpRangeMatch are
 * the original helpers, unchanged. rangePrefilter, followUpDatePrefilter and
 * slimForUnwind are new: they run before $unwind so a rollup stops unpacking
 * every visit of every customer on every request.
 */
import { visitViewScope } from './visitAccess.js';

export const getAggregationDateRef = (prefix) => ({
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

export const getAggregationRangeMatch = (start, end, prefix, additionalMatch = {}) => {
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

export const getFollowUpRangeMatch = (start, end, additionalMatch = {}) => {
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

const ymd = (d) => d?.toISOString().split('T')[0];

/**
 * A document-level $match to put before `$unwind: "$<prefix>"`, so only
 * customers holding at least one entry that could be in range get unpacked.
 * Uses the same string comparison getAggregationRangeMatch applies after the
 * unwind, so it keeps every entry that match would; an entry whose date isn't
 * a string (that match falls back to createdAt for it) is always let through
 * for the match after the unwind to decide. Null when there's no range.
 */
export const rangePrefilter = (start, end, prefix) => {
  const startStr = ymd(start);
  const endStr = ymd(end);
  if (!startStr && !endStr) return null;
  const range = {};
  if (startStr) range.$gte = startStr;
  if (endStr) range.$lte = endStr;
  return { $match: { [prefix]: { $elemMatch: { $or: [{ date: range }, { date: { $not: { $type: 'string' } } }] } } } };
};

/** Same idea for "follow-up due on `dayStr`": a string equal to it, or a Date for the match after to format. */
export const followUpDatePrefilter = (dayStr) => ({
  $match: { visits: { $elemMatch: { $or: [{ followUpDate: dayStr }, { followUpDate: { $type: 'date' } }] } } }
});

/**
 * Trim each customer to what a rollup over `<prefix>` reads, before `$unwind`
 * copies the whole document once per entry. A customer with photos stored
 * inline in its visits was being copied megabytes at a time per visit, for
 * output that never includes the photos.
 */
export const slimForUnwind = (prefix) => [
  { $project: { company: 1, contactName: 1, location: 1, [prefix]: 1 } },
  { $unset: `${prefix}.image` }
];

/**
 * Whose visits and resources a person's dashboard shows, from the permissions
 * on their role (visitViewScope in visitAccess.js — Users & Roles → Visits):
 *   view_all_visits     → everything, every branch
 *   view_branch_visits  → every rep's entries, for customers in the person's
 *                         assigned branches ('*' = all)
 *   neither             → only the entries they logged themselves
 * Returns { kind: 'all' } | { kind: 'branches', locations } | { kind: 'own', userId }.
 */
export const dashboardScope = ({ permissions, userId, assignedLocations } = {}) => {
  const scope = visitViewScope({ permissions, assignedLocations });
  return scope.kind === 'own' ? { kind: 'own', userId: String(userId ?? '') } : scope;
};

/** A first-stage $match limiting customers to a manager's branches; null for any other scope. */
export const scopeBranchPrefilter = (scope) =>
  (scope?.kind === 'branches' ? { $match: { location: { $in: scope.locations } } } : null);

/** The additionalMatch for getAggregationRangeMatch/getFollowUpRangeMatch: own visits only, or nothing. */
export const scopeVisitUserMatch = (scope) =>
  (scope?.kind === 'own' ? { 'visits.createdBy': scope.userId } : {});

/**
 * Narrow a dashboardScope to one branch picked in the dashboard's location
 * filter. Never widens: a manager asking for a branch outside their own gets
 * nothing, and an "own" scope (who only ever sees what they logged) ignores it.
 */
export const narrowScopeToLocation = (scope, location) => {
  const loc = typeof location === 'string' ? location.trim() : '';
  if (!loc || loc === '*' || !scope || scope.kind === 'own') return scope;
  if (scope.kind === 'all') return { kind: 'branches', locations: [loc] };
  return { kind: 'branches', locations: scope.locations.includes(loc) ? [loc] : [] };
};
