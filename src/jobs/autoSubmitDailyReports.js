import DailyReport from '../models/DailyReport.js';
import { BRANCH_NAMES, branchNow, shiftDate } from '../config/branches.js';
import { deriveFromSystem, applyDerived, claimSubmission } from '../routes/dailyReports.js';
import { notifyDailyReportSubmission } from '../utils/dailyReportSubmissionEmail.js';

/**
 * Submit the day for anyone who went home without doing it.
 *
 * At 11:59 PM on the branch's own clock, any draft still open for that day is
 * signed off as it stands. The point is that a day's figures stop being
 * editable once the day is over — a report amended a week later is not a record
 * of anything.
 *
 * A day nobody opened is filed too, if anything happened at the branch that
 * day — a check-in, a delivery, a pick-up, a return or a transfer (owner's
 * call, 2026-10-05: Seattle had days with deliveries and no report, so no
 * evening email). It's built from the system's figures alone and marked
 * auto-submitted. A day with nothing at all stays "Not started": a sheet of
 * automatic zeros would claim someone looked.
 *
 * Auto-submitted days are marked as such, and reopening one is the same
 * permission-gated act as reopening any other — that is the way back in.
 *
 * This has to derive and apply the day's real figures itself before locking
 * anything in — it cannot just flip status on whatever the last draft save
 * left behind. A draft intentionally stores Deliveries/Pick-ups slabs (and any
 * auto transfer line nobody hand-corrected) as null after every autosave, so
 * they keep re-deriving from the schedule on the next page load — see
 * buildDraftPayload in src/components/sales/dailyreport/savePayload.js and the
 * 2026-08-28 incident note on applyDerived in ../routes/dailyReports.js. A day
 * nobody reopened after their last edit was freezing at whatever null the
 * previous autosave had deliberately left. The fix is to run the same derive
 * the load route runs, apply it, and persist the result as part of the very
 * same write that sets status to submitted. The manual Submit route (POST
 * /:date/submit) does the same since 2026-10-05, so both sign off the figures
 * as of the moment they lock.
 */

const CUTOFF_MINUTES = 23 * 60 + 59;     // 11:59 PM, in the branch's timezone
const TICK_MS = 60 * 1000;

/**
 * How far back a restart may catch up. The rule is "a day that is over gets
 * submitted", so an instance that was asleep at 11:59 finishes the job when it
 * wakes — but bounded, so deploying this doesn't reach back through months of
 * old drafts and lock them all at once.
 */
const LOOKBACK_DAYS = 3;

export const AUTO_SUBMITTED_BY = 'Auto-submitted';

/**
 * Whether a draft is due to be signed off now, on the branch's clock.
 *
 *  - A day nobody reopened: once it's over — today at 11:59 PM, or straight
 *    away for an earlier day (an instance asleep at 11:59 catching up).
 *  - A reopened day: it waits for the person who reopened it to submit, like
 *    today does. If nobody does, it's signed off at the first 11:59 PM after
 *    it was reopened (owner's call, 2026-10-05). Before this a reopened
 *    yesterday was locked again within a minute, often before the
 *    correction it was reopened for had been made.
 */
export function isDueForAutoSubmit(report, location, now = new Date()) {
  const { date: today, minutes } = branchNow(location, now);
  const pastCutoff = minutes >= CUTOFF_MINUTES;
  if (report.reopenedAt) {
    const reopened = branchNow(location, new Date(report.reopenedAt));
    // Reopened after 11:59 PM: that night's cutoff has gone, so the next one.
    const dueOn = reopened.minutes < CUTOFF_MINUTES ? reopened.date : shiftDate(reopened.date, 1);
    return today > dueOn || (today === dueOn && pastCutoff);
  }
  if (report.date < today) return true;
  return report.date === today && pastCutoff;
}

/** Anything happened at the branch that day, by the system's own figures. */
export const hasActivity = (derived) => Boolean(
  derived && (derived.visitorCheckIns > 0 || derived.deliveriesAssigned > 0 || derived.pickupsAssigned > 0
    || derived.returnsCount > 0 || (derived.transfers || []).length > 0)
);

// A quiet branch-day is re-checked at most hourly, not on every one-minute
// tick: most of the 13 branches have nothing on most days, and deriving each
// of them every minute would be ~40 queries a minute for nothing. A ticket
// added later for a past day is still picked up within the hour.
const QUIET_RECHECK_MS = 60 * 60 * 1000;
const quietSince = new Map();

/**
 * File a day nobody opened: create its report from the system's figures and
 * submit it in one insert. Resolves the new document, or null if there was
 * nothing to report or someone created the day meanwhile (the unique
 * { date, location } index refuses the second insert).
 */
export async function fileUnopenedDay(date, location, now = new Date()) {
  const key = `${location}|${date}`;
  const checked = quietSince.get(key);
  if (checked && now - checked < QUIET_RECHECK_MS) return null;

  const derived = await deriveFromSystem(date, location);
  if (!hasActivity(derived)) {
    if (quietSince.size > 2000) quietSince.clear(); // keeps a long-running server's memory flat
    quietSince.set(key, now);
    return null;
  }
  quietSince.delete(key);

  const report = new DailyReport({ date, location });
  applyDerived(report, derived);
  report.status = 'submitted';
  report.submittedAt = now;
  report.submittedBy = AUTO_SUBMITTED_BY;
  report.autoSubmitted = true;
  try {
    return await report.save();
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }
}

/**
 * One pass. Exported on its own so it can be run by hand or tested without a
 * timer: `node -e "..."` against a database is the whole test.
 */
export async function autoSubmitDueDays(now = new Date()) {
  const submitted = [];

  for (const location of BRANCH_NAMES) {
    const { date } = branchNow(location, now);

    // Candidates: this branch's recent days (catch-up is bounded by the
    // lookback), plus any earlier day someone reopened — a reopened day is
    // still signed off at its 11:59 PM however old it is. isDueForAutoSubmit
    // then decides which of them are due right now.
    const dates = [date];
    for (let back = 1; back <= LOOKBACK_DAYS; back++) dates.push(shiftDate(date, -back));

    // Full documents, not just ids — each one needs its own derive/apply
    // before it can be written back, unlike the old single updateMany that
    // could flip every due draft in one call because it never had to look at
    // what was actually in any of them.
    const candidates = await DailyReport.find({
      location,
      status: 'draft',
      $or: [{ date: { $in: dates } }, { reopenedAt: { $ne: null }, date: { $lt: date } }]
    });
    const drafts = candidates.filter((r) => isDueForAutoSubmit(r, location, now));

    let count = 0;

    for (const report of drafts) {
      const derived = await deriveFromSystem(report.date, location);
      // Fills only what a human never touched — an existing hand correction
      // is left exactly as typed. Safe to call unconditionally: applyDerived
      // itself is a no-op on anything already submitted, which nothing here
      // is yet.
      applyDerived(report, derived);

      report.status = 'submitted';
      report.submittedAt = now;
      report.submittedBy = AUTO_SUBMITTED_BY;
      report.autoSubmitted = true;

      // The atomic claim (claimSubmission — the same one manual Submit uses),
      // not the derive above it, is what has to be race-safe. Two instances
      // ticking the same second, or a person pressing Submit at 11:59, may
      // both derive the same day harmlessly; only one write can match a
      // document still in 'draft', and the loser's simply matches nothing.
      const claimed = await claimSubmission(report);
      if (!claimed) continue;

      count++;
      // Every branch gets its day closed out; only Seattle's office reads the
      // evening summary email, same as before this derived its own figures.
      if (location === 'Seattle') notifyDailyReportSubmission(claimed.toObject());
    }

    // Days that are over with no report at all — nobody opened the sheet.
    // Filed if the branch had any activity that day (hasActivity).
    const dueDates = dates.filter((d) => isDueForAutoSubmit({ date: d }, location, now));
    const existing = new Set((await DailyReport.find({ location, date: { $in: dueDates } }, 'date').lean()).map((r) => r.date));
    for (const day of dueDates.filter((d) => !existing.has(d))) {
      const created = await fileUnopenedDay(day, location, now);
      if (!created) continue;
      count++;
      if (location === 'Seattle') notifyDailyReportSubmission(created.toObject());
    }

    if (count > 0) submitted.push({ location, count });
  }

  return submitted;
}

/**
 * Start the ticker. Returns the interval so a caller can stop it; set
 * DAILY_REPORT_AUTO_SUBMIT=false to keep days open indefinitely instead.
 */
export function startAutoSubmitDailyReports() {
  if (String(process.env.DAILY_REPORT_AUTO_SUBMIT).toLowerCase() === 'false') {
    console.log('🕚 Daily report auto-submit is off (DAILY_REPORT_AUTO_SUBMIT=false)');
    return null;
  }

  const tick = async () => {
    try {
      const done = await autoSubmitDueDays();
      for (const { location, count } of done) {
        console.log(`🕚 Auto-submitted ${count} daily report${count === 1 ? '' : 's'} for ${location}`);
      }
    } catch (error) {
      console.error('🕚 Daily report auto-submit failed:', error.message);
    }
  };

  // Once on boot, so a restart over midnight still closes the day out.
  tick();

  const timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  console.log('🕚 Daily report auto-submit running — 11:59 PM at each branch');
  return timer;
}
