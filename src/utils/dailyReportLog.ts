/**
 * A Daily Work Report's log: every submit, reopen, email and line added after
 * submit, in order (More → View Log on the day sheet). Shared by the server,
 * which writes the entries, and the screen, which words them.
 *
 * Before the log (2026-11-04) a report only kept its latest submit and its
 * latest reopen, in its own fields — a second reopen overwrote the first, and
 * an auto-submit after a reopen overwrote who had submitted it. `reportLog`
 * still shows what those fields hold for older days, marked as such.
 */

export const LOG_ACTIONS = ['submitted', 'auto_submitted', 'reopened', 'emailed', 'email_failed', 'transfer_added'] as const;
export type LogAction = typeof LOG_ACTIONS[number];

/** `earlier`: copied from the report's own fields, kept before the log existed. */
export type LogEntry = { at: string | Date; by: string; action: LogAction; note: string; earlier?: boolean };
export type ShownLogEntry = LogEntry;

/** What every write stores. `note` is the reopen reason, who an email went to, or the line added. */
export const logEntry = (action: LogAction, by?: string | null, note?: string | null, at: Date = new Date()): LogEntry => ({
  at,
  by: String(by ?? '').trim(),
  action,
  note: String(note ?? '').trim().slice(0, 500)
});

/** The submitter the 11:59 PM job writes (AUTO_SUBMITTED_BY in the job). */
const AUTO_NAME = 'Auto-submitted';

type LoggedReport = {
  log?: LogEntry[] | null;
  submittedBy?: string | null;
  submittedAt?: string | Date | null;
  autoSubmitted?: boolean | null;
  reopenedBy?: string | null;
  reopenedAt?: string | Date | null;
  reopenReason?: string | null;
};

const time = (d: string | Date | null | undefined) => (d ? new Date(d).getTime() : NaN);

/**
 * The log as the screen shows it, oldest first: what's stored, in the order
 * it was written, plus — for a
 * day saved before the log existed — the submit and reopen its own fields
 * kept, when they're older than the first stored entry (newer ones are in the
 * log already). `earlier` says some of it came from those fields, so the
 * screen can say older events may be missing.
 */
export function reportLog(report: LoggedReport | null | undefined): { entries: ShownLogEntry[]; earlier: boolean } {
  if (!report) return { entries: [], earlier: false };
  const stored: ShownLogEntry[] = (report.log || []).filter((e) => e && LOG_ACTIONS.includes(e.action));
  const firstStored = Math.min(...stored.map((e) => time(e.at)).filter(Number.isFinite));
  const before = (at: string | Date | null | undefined) => Number.isFinite(time(at)) && !(time(at) >= firstStored);

  const fromFields: ShownLogEntry[] = [];
  if (report.submittedAt && before(report.submittedAt)) {
    // A reopen clears autoSubmitted but keeps the name, so the name decides.
    const auto = report.autoSubmitted || report.submittedBy === AUTO_NAME;
    fromFields.push({
      ...logEntry(auto ? 'auto_submitted' : 'submitted', auto ? '' : report.submittedBy, '', new Date(report.submittedAt)),
      earlier: true
    });
  }
  if (report.reopenedAt && before(report.reopenedAt)) {
    fromFields.push({ ...logEntry('reopened', report.reopenedBy, report.reopenReason, new Date(report.reopenedAt)), earlier: true });
  }

  // Stored entries stay in the order they were written (two servers' clocks,
  // or a job run for another time, can disagree); the fields' ones are all
  // older than the first of them, so they go in front, oldest first.
  fromFields.sort((a, b) => time(a.at) - time(b.at));
  const entries = [...fromFields, ...stored];
  return { entries, earlier: entries.some((e) => e.earlier) };
}

/**
 * What a write should store ahead of its own entry: the older submit / reopen
 * the report's fields still hold and the log doesn't. Stored once, they
 * survive the next submit or reopen overwriting those fields.
 */
export const entriesFromFields = (report: LoggedReport | null | undefined): LogEntry[] =>
  reportLog(report).entries.filter((e) => e.earlier && !(report?.log || []).includes(e));

/** What a log row says: the headline and, under it, the detail. */
export function logWords(entry: LogEntry): { title: string; detail: string } {
  const by = entry.by ? ` by ${entry.by}` : '';
  switch (entry.action) {
    case 'submitted': return { title: `Submitted${by}`, detail: '' };
    case 'auto_submitted': return { title: 'Submitted automatically', detail: 'at 11:59 PM, as it stood' };
    case 'reopened': return { title: `Reopened${by}`, detail: entry.note ? `“${entry.note}”` : '' };
    case 'emailed': return { title: entry.by ? `Emailed by ${entry.by}` : 'Emailed', detail: entry.note };
    case 'email_failed': return { title: 'Email not sent', detail: entry.note };
    case 'transfer_added': return { title: `Transfer added after submit${by}`, detail: entry.note };
    default: return { title: String(entry.action), detail: entry.note || '' };
  }
}
