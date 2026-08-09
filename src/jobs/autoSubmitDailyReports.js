import DailyReport from '../models/DailyReport.js';
import { BRANCH_NAMES, branchNow, shiftDate } from '../config/branches.js';

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

    // Conditional on status inside the update, so two instances ticking at the
    // same second can't both claim the same day.
    const result = await DailyReport.updateMany(
      { location, date: { $in: dates }, status: 'draft' },
      {
        $set: {
          status: 'submitted',
          submittedAt: now,
          submittedBy: AUTO_SUBMITTED_BY,
          autoSubmitted: true
        }
      }
    );

    if (result.modifiedCount > 0) {
      submitted.push({ location, count: result.modifiedCount });
    }
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
