/** Original dashboard queries, moved unchanged from server.ts; the caller supplies the already-decided scope and dates. */
import mongoose from 'mongoose';
import Customer from '../../models/Customer.ts';
import User from '../../models/User.ts';
import { displayNameOf } from '../../utils/salesReps.ts';
import { idVariants } from '../../services/teamDirectory.ts';
import { getAggregationRangeMatch, getFollowUpRangeMatch, rangePrefilter, followUpDatePrefilter,
  slimForUnwind, peopleMatch, peoplePrefilter } from '../../utils/dashboardMatch.ts';
import type { DashboardReadQuery, DashboardRollupQuery, DashboardRollups } from './types.ts';
import type { Loose } from '../../types/records.ts';

export async function dashboardVisits({ people, startDate, endDate, filterType }: DashboardReadQuery): Promise<Loose[]> {
    const visitsOfPeople = peopleMatch(people, 'visits');

    // Handle fallback logic for matching
    const dateMatch = filterType === 'followup'
      ? getFollowUpRangeMatch(startDate, endDate)
      : getAggregationRangeMatch(startDate, endDate, "visits");

    // Filter and slim customers before $unwind (src/utils/dashboardMatch.ts).
    // Follow-ups have no early filter: getFollowUpRangeMatch also counts an
    // entry whose follow-up fields are missing, so nearly every visit passes.
    const visitPrefilter = filterType === 'followup' ? null : rangePrefilter(startDate, endDate, 'visits');
    const visits = await Customer.aggregate(([
      ...(visitsOfPeople ? [peoplePrefilter(people, 'visits', idVariants)] : []),
      ...(visitPrefilter ? [visitPrefilter] : []),
      // Follow-up rows also carry the customer's phone and city (Dashboard → Follow-ups).
      ...slimForUnwind('visits', filterType === 'followup' ? ['phone', 'address.city'] : []),
      { $unwind: "$visits" },
      { $match: dateMatch },
      ...(visitsOfPeople ? [visitsOfPeople] : []),
      {
        $project: {
          _id: "$visits._id",
          date: {
            $cond: [
              { $eq: [{ $type: "$visits.date" }, "string"] },
              "$visits.date",
              {
                $ifNull: [
                  "$visits.date",
                  {
                    $cond: [
                      { $eq: [{ $type: "$visits.createdAt" }, "date"] },
                      { $dateToString: { format: "%Y-%m-%d", date: "$visits.createdAt" } },
                      { $substr: ["$visits.createdAt", 0, 10] }
                    ]
                  }
                ]
              }
            ]
          },
          purpose: "$visits.purpose",
          notes: "$visits.notes",
          outcome: "$visits.outcome",
          nextAction: "$visits.nextAction",
          managerComment: "$visits.managerComment",
          headquartersComment: "$visits.headquartersComment",
          followUp: "$visits.followUp",
          followUpDate: "$visits.followUpDate",
          followUpDoneAt: "$visits.followUpDoneAt",
          followUpDoneOn: "$visits.followUpDoneOn",
          followUpDoneByName: "$visits.followUpDoneByName",
          followUpOutcome: "$visits.followUpOutcome",
          followUpHistory: "$visits.followUpHistory",
          phone: "$phone",
          city: "$address.city",
          createdBy: "$visits.createdBy",
          createdAt: {
            $cond: [
              { $eq: [{ $type: "$visits.createdAt" }, "date"] },
              { $dateToString: { format: "%Y-%m-%dT%H:%M:%S.%LZ", date: "$visits.createdAt" } },
              "$visits.createdAt"
            ]
          },
          customerId: "$_id",
          customerName: {
            $concat: [
              { $ifNull: ["$company", ""] },
              { $cond: [{ $and: ["$company", "$contactName"] }, " - ", ""] },
              { $ifNull: ["$contactName", ""] }
            ]
          },
          // Separately too, for the list + detail view (VisitsListDetail.jsx):
          // company over contact, the customer's branch, and who logged it.
          // Photos aren't here — the detail fetches them for the one visit
          // being looked at, so this list stays small.
          company: "$company",
          contactName: "$contactName",
          location: "$location",
          createdByName: "$visits.createdByName"
        }
      },
      { $sort: { date: -1, createdAt: -1 } }
    ] as mongoose.PipelineStage[]));

    return visits;
}

export async function dashboardResources({ people, startDate, endDate }: DashboardReadQuery): Promise<Loose[]> {
    const resourcesOfPeople = peopleMatch(people, 'resources');
    const rangeMatch = getAggregationRangeMatch(startDate, endDate, "resources");

    const resourcePrefilter = rangePrefilter(startDate, endDate, 'resources');
    const resources = await Customer.aggregate(([
      ...(resourcesOfPeople ? [peoplePrefilter(people, 'resources', idVariants)] : []),
      ...(resourcePrefilter ? [resourcePrefilter] : []),
      ...slimForUnwind('resources', ['city']),
      { $unwind: "$resources" },
      ...(resourcesOfPeople ? [resourcesOfPeople] : []),
      { $match: rangeMatch.$expr ? rangeMatch : {} },
      {
        $project: {
          _id: "$resources._id",
          name: "$resources.name",
          description: "$resources.description",
          type: "$resources.type",
          resourceType: "$resources.resourceType",
          // The Resources list (Option A): how many, the note, and the
          // customer's branch (for who may edit) and city.
          qty: "$resources.qty",
          notes: "$resources.notes",
          status: "$resources.status",
          customerLocation: "$location",
          city: "$city",
          company: "$company",
          contactName: "$contactName",
          date: {
            $cond: [
              { $eq: [{ $type: "$resources.date" }, "string"] },
              "$resources.date",
              {
                $ifNull: [
                  "$resources.date",
                  {
                    $cond: [
                      { $eq: [{ $type: "$resources.createdAt" }, "date"] },
                      { $dateToString: { format: "%Y-%m-%d", date: "$resources.createdAt" } },
                      { $substr: ["$resources.createdAt", 0, 10] }
                    ]
                  }
                ]
              }
            ]
          },
          content: "$resources.content",
          uploadedBy: { $ifNull: ["$resources.uploadedBy", "$resources.createdBy"] },
          createdAt: {
            $cond: [
              { $eq: [{ $type: "$resources.createdAt" }, "date"] },
              { $dateToString: { format: "%Y-%m-%dT%H:%M:%S.%LZ", date: "$resources.createdAt" } },
              "$resources.createdAt"
            ]
          },
          customerId: "$_id",
          customerName: {
            $concat: [
              { $ifNull: ["$company", ""] },
              { $cond: [{ $and: ["$company", "$contactName"] }, " - ", ""] },
              { $ifNull: ["$contactName", ""] }
            ]
          }
        }
      },
      { $sort: { date: -1, createdAt: -1 } }
    ] as mongoose.PipelineStage[]));

    // Who logged each one, by name (the list's "Logged by" and its filter).
    const uploaderIds = [...new Set(resources.map(r => String(r.uploadedBy || '')).filter(id => /^[a-f0-9]{24}$/i.test(id)))];
    const uploaders = uploaderIds.length
      ? await User.find({ _id: { $in: uploaderIds } }).select('username displayName').lean()
      : [];
    const nameById = new Map(uploaders.map(u => [String(u._id), displayNameOf(u)]));
    resources.forEach(r => { r.uploadedByName = nameById.get(String(r.uploadedBy || '')) || ''; });

    return resources;
}

export async function dashboardRollups({ people, startDate, endDate, today: todayStr, userId }: DashboardRollupQuery): Promise<DashboardRollups> {
    const visitsOfPeople = peopleMatch(people, 'visits');
    const visitPeopleBefore = visitsOfPeople ? [peoplePrefilter(people, 'visits', idVariants)] : [];
    const visitPeopleAfter = visitsOfPeople ? [visitsOfPeople] : [];
    const visitDateMatch = getAggregationRangeMatch(startDate, endDate, "visits");

    // The five rollups below are independent, so they run at once (Promise.all
    // further down) rather than one after another. Each filters and slims
    // customers before $unwind — see src/utils/dashboardMatch.ts.
    const visitRangePrefilter = rangePrefilter(startDate, endDate, 'visits');

    // Aggregation for Visits Stats (Strictly by Visit Date)
    const visitStatsQuery = Customer.aggregate(([
      ...visitPeopleBefore,
      ...(visitRangePrefilter ? [visitRangePrefilter] : []),
      ...slimForUnwind('visits'),
      { $unwind: "$visits" },
      { $match: visitDateMatch },
      ...visitPeopleAfter,
      {
        $group: {
          _id: null,
          visits: {
            $sum: 1
          },
          keyVisits: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $regexMatch: { input: { $ifNull: ["$visits.outcome", ""] }, regex: /order|sale|sold|deposit/i } },
                    { $regexMatch: { input: { $ifNull: ["$visits.notes", ""] }, regex: /order|sale|sold/i } }
                  ]
                },
                1, 0
              ]
            }
          },
          bids: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $regexMatch: { input: { $ifNull: ["$visits.outcome", ""] }, regex: /bid|quote/i } },
                    { $regexMatch: { input: { $ifNull: ["$visits.notes", ""] }, regex: /bid|quote/i } }
                  ]
                },
                1, 0
              ]
            }
          },
          followUp: { $sum: 0 } // Move to separate aggregation
        }
      }
    ] as mongoose.PipelineStage[]));

    // Ticked done → not counted in today's follow-ups below either (blank or missing = pending).
    const followUpPending = { $match: { 'visits.followUpDoneAt': { $in: [null, ''] } } };

    // Today's Schedule count

    const scheduleCountQuery = Customer.aggregate(([
      ...visitPeopleBefore,
      followUpDatePrefilter(todayStr),
      ...slimForUnwind('visits'),
      { $unwind: "$visits" },
      followUpPending,
      ...visitPeopleAfter,
      {
        $match: {
          $expr: {
            $eq: [
              {
                $cond: [
                  { $eq: [{ $type: "$visits.followUpDate" }, "date"] },
                  { $dateToString: { format: "%Y-%m-%d", date: "$visits.followUpDate" } },
                  "$visits.followUpDate"
                ]
              },
              todayStr
            ]
          }
        }
      },
      { $count: "count" }
    ] as mongoose.PipelineStage[]));

    // Resources follow the same people as visits: whoever uploaded each one.
    const resourceRange = getAggregationRangeMatch(startDate, endDate, "resources");
    const resourcePrefilter = rangePrefilter(startDate, endDate, 'resources');
    const resourcesOfPeople = peopleMatch(people, 'resources');
    const resourceStatsQuery = Customer.aggregate(([
      ...(resourcesOfPeople ? [peoplePrefilter(people, 'resources', idVariants)] : []),
      ...(resourcePrefilter ? [resourcePrefilter] : []),
      ...slimForUnwind('resources'),
      { $unwind: "$resources" },
      ...(resourcesOfPeople ? [resourcesOfPeople] : []),
      { $match: resourceRange.$expr ? resourceRange : {} },
      { $count: "count" }
    ] as mongoose.PipelineStage[]));

    // Count Unified Leads for current user (any Customer with a status set)
    const leadCountQuery = Customer.countDocuments({ 
      createdBy: userId, 
      status: { $exists: true } 
    });

    const [visitStats, scheduleCount, resourceStats, leadCount] = await Promise.all([
      visitStatsQuery, scheduleCountQuery, resourceStatsQuery, leadCountQuery
    ]);
    return {
      visits: visitStats[0]?.visits || 0, keyVisits: visitStats[0]?.keyVisits || 0,
      bids: visitStats[0]?.bids || 0, resources: resourceStats[0]?.count || 0,
      leads: leadCount, todayScheduleCount: scheduleCount[0]?.count || 0
    };
}
