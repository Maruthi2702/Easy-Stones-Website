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
 * output that never includes the photos. `extra` keeps more customer fields
 * (the Resources list shows the customer's city).
 */
export const slimForUnwind = (prefix, extra = []) => [
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
const authorOf = (prefix) => (prefix === 'resources'
  ? { $toString: { $ifNull: ['$resources.uploadedBy', '$resources.createdBy'] } }
  : { $toString: `$${prefix}.createdBy` });

/** A $match for after `$unwind: "$<prefix>"` keeping only `people`'s entries; null for everyone. */
export const peopleMatch = (people, prefix) =>
  (people === '*' ? null : { $match: { $expr: { $in: [authorOf(prefix), [...people]] } } });

/**
 * A document-level $match for before the unwind: only customers holding an
 * entry by one of `people`. `idVariants` turns an id into every form it may be
 * stored in (string and ObjectId) — the exact check is peopleMatch's. Null for
 * everyone.
 */
export const peoplePrefilter = (people, prefix, idVariants = (id) => [id]) => {
  if (people === '*') return null;
  const values = [...people].flatMap(idVariants);
  const fields = prefix === 'resources' ? ['uploadedBy', 'createdBy'] : ['createdBy'];
  return { $match: { $or: fields.map((f) => ({ [`${prefix}.${f}`]: { $in: values } })) } };
};
