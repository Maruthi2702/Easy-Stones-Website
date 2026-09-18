import DailyReport from '../models/DailyReport.js';
import { BRANCH_NAMES, branchNow, shiftDate, utcOffsetMinutes } from '../config/branches.js';
import { deriveFromSystem, applyDerived } from '../routes/dailyReports.js';
import { notifyDailyReportSubmission } from '../utils/dailyReportSubmissionEmail.js';

/**
 * Submit the day for anyone who went home without doing it.
 *
 * At 11:59 PM on the branch's own clock, any draft still open for that day is
 * signed off as it stands. The point is that a day's figures stop being
 * editable once the day is over — a report amended a week later is not a record
 * of anything. Nothing is invented: only days somebody actually worked on are
 * submitted, because a draft only exists once a figure has been typed. A branch
 * that never opened the sheet stays "Not started", which is the truth, where a
 * sheet of automatic zeros would be a lie.
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
 * 2026-08-28 incident note on applyDerived in ../routes/dailyReports.js. The
 * manual Submit button covers for that by having the browser PUT the real,
 * currently-displayed values immediately before calling POST .../submit — but
 * there is no browser here, so nothing ever did that PUT, and a day nobody
 * reopened after their last edit was freezing at whatever null the previous
 * autosave had deliberately left. The fix is to run the same derive this job's
 * own load route runs, apply it, and persist the result as part of the very
 * same write that sets status to submitted.
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
 * One pass. Exported on its own so it can be run by hand or tested without a
 * timer: `node -e "..."` against a database is the whole test.
 */
export async function autoSubmitDueDays(now = new Date()) {
  const submitted = [];

  for (const location of BRANCH_NAMES) {
    const { date, minutes } = branchNow(location, now);

    // Days that are over for this branch: the ones behind it, and today too
    // once its clock passes 11:59 PM.
    const dates = [];
    for (let back = 1; back <= LOOKBACK_DAYS; back++) dates.push(shiftDate(date, -back));
    if (minutes >= CUTOFF_MINUTES) dates.push(date);

    // Full documents, not just ids — each one needs its own derive/apply
    // before it can be written back, unlike the old single updateMany that
    // could flip every due draft in one call because it never had to look at
    // what was actually in any of them.
    const drafts = await DailyReport.find({ location, date: { $in: dates }, status: 'draft' });
    if (!drafts.length) continue;

    const tz = utcOffsetMinutes(location, now);
    let count = 0;

    for (const report of drafts) {
      const derived = await deriveFromSystem(report.date, location, tz);
      // Fills only what a human never touched — an existing hand correction
      // is left exactly as typed. Safe to call unconditionally: applyDerived
      // itself is a no-op on anything already submitted, which nothing here
      // is yet.
      applyDerived(report, derived);

      report.status = 'submitted';
      report.submittedAt = now;
      report.submittedBy = AUTO_SUBMITTED_BY;
      report.autoSubmitted = true;

      // findOneAndUpdate against the id *and* status: 'draft', not
      // report.save() — the atomic claim, not the derive above it, is what
      // has to be race-safe. Two instances ticking the same second may both
      // derive the same day harmlessly (identical, read-only computation from
      // the same source data); only one of their subsequent writes can match
      // a document still in 'draft', so only one of them ever actually flips
      // it, and the loser's update here simply matches nothing.
      const payload = report.toObject();
      // _id can't move and shouldn't be restated in $set; __v is left for
      // Mongo's own bookkeeping rather than pinned to whatever this process
      // happened to read a moment ago.
      delete payload._id;
      delete payload.__v;

      const claimed = await DailyReport.findOneAndUpdate(
        { _id: report._id, status: 'draft' },
        { $set: payload },
        { new: true }
      );
      if (!claimed) continue;

      count++;
      // Every branch gets its day closed out; only Seattle's office reads the
      // evening summary email, same as before this derived its own figures.
      if (location === 'Seattle') notifyDailyReportSubmission(claimed.toObject());
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
