import { describe, it, expect } from 'vitest';
import { logEntry, reportLog, logWords, entriesFromFields } from './dailyReportLog.ts';

const at = (iso: string) => new Date(iso);

describe('Daily Report log', () => {
  it('logEntry trims and caps what it stores', () => {
    const e = logEntry('reopened', '  Jeremy ', ` ${'x'.repeat(600)} `, at('2026-11-04T01:57:00Z'));
    expect(e.by).toBe('Jeremy');
    expect(e.note).toHaveLength(500);
    expect(logEntry('auto_submitted').by).toBe('');
  });

  it('a day with nothing has no entries', () => {
    expect(reportLog(null)).toEqual({ entries: [], earlier: false });
    expect(reportLog({})).toEqual({ entries: [], earlier: false });
  });

  it('stored entries come back in the order they were written', () => {
    const log = [
      logEntry('submitted', 'Scott', '', at('2026-11-04T01:52:00Z')),
      logEntry('reopened', 'Jeremy', 'update payments', at('2026-11-04T01:57:00Z')),
      logEntry('auto_submitted', '', '', at('2026-11-04T07:59:00Z'))
    ];
    const { entries, earlier } = reportLog({
      log, submittedAt: at('2026-11-04T07:59:00Z'), submittedBy: 'Auto-submitted', autoSubmitted: true,
      reopenedAt: at('2026-11-04T01:57:00Z'), reopenedBy: 'Jeremy', reopenReason: 'update payments'
    });
    expect(entries.map((e) => e.action)).toEqual(['submitted', 'reopened', 'auto_submitted']);
    // The fields only repeat what the log holds — nothing added twice.
    expect(earlier).toBe(false);
  });

  it('a day saved before the log shows what its fields kept (Seattle, Nov 3)', () => {
    const { entries, earlier } = reportLog({
      submittedAt: at('2026-11-04T07:59:30Z'), submittedBy: 'Auto-submitted', autoSubmitted: true,
      reopenedAt: at('2026-11-04T01:57:36Z'), reopenedBy: 'Jeremy Earnest', reopenReason: 'update payments'
    });
    expect(earlier).toBe(true);
    expect(entries.map((e) => [e.action, e.by, e.note])).toEqual([
      ['reopened', 'Jeremy Earnest', 'update payments'],
      ['auto_submitted', '', '']
    ]);
  });

  it('older fields are kept beside newer log entries', () => {
    // Reopened before the log existed, submitted after it.
    const { entries, earlier } = reportLog({
      log: [logEntry('submitted', 'Diana', '', at('2026-11-05T01:00:00Z'))],
      submittedAt: at('2026-11-05T01:00:00Z'), submittedBy: 'Diana',
      reopenedAt: at('2026-11-03T18:00:00Z'), reopenedBy: 'Jeremy', reopenReason: 'fix slabs'
    });
    expect(earlier).toBe(true);
    expect(entries.map((e) => e.action)).toEqual(['reopened', 'submitted']);
  });

  it('a reopened auto-submitted day still reads as automatic (reopen clears the flag)', () => {
    const { entries } = reportLog({ submittedAt: at('2026-11-02T07:59:00Z'), submittedBy: 'Auto-submitted', autoSubmitted: false });
    expect(entries[0].action).toBe('auto_submitted');
    expect(entries[0].by).toBe('');
  });

  it('the first write stores what the fields kept, once', () => {
    const old = {
      submittedAt: at('2026-11-04T07:59:30Z'), submittedBy: 'Auto-submitted', autoSubmitted: true,
      reopenedAt: at('2026-11-04T01:57:36Z'), reopenedBy: 'Jeremy Earnest', reopenReason: 'update payments'
    };
    const seeded = entriesFromFields(old);
    expect(seeded.map((e) => e.action)).toEqual(['reopened', 'auto_submitted']);
    // Reopened again later: the fields now hold the new reopen, Jeremy's is in the log.
    const later = {
      ...old, log: [...seeded, logEntry('reopened', 'Diana', 'add sinks', at('2026-11-05T17:00:00Z'))],
      reopenedAt: at('2026-11-05T17:00:00Z'), reopenedBy: 'Diana', reopenReason: 'add sinks', status: 'draft'
    };
    expect(entriesFromFields(later)).toEqual([]);
    const { entries, earlier } = reportLog(later);
    expect(entries.map((e) => [e.action, e.by])).toEqual([
      ['reopened', 'Jeremy Earnest'], ['auto_submitted', ''], ['reopened', 'Diana']
    ]);
    expect(earlier).toBe(true);
  });

  it('words each kind of entry', () => {
    expect(logWords(logEntry('submitted', 'Scott'))).toEqual({ title: 'Submitted by Scott', detail: '' });
    expect(logWords(logEntry('reopened', 'Jeremy', 'update payments')).detail).toBe('“update payments”');
    expect(logWords(logEntry('auto_submitted')).title).toBe('Submitted automatically');
    expect(logWords(logEntry('emailed', '', "To the branch's Daily Report list (3)")).title).toBe('Emailed');
    expect(logWords(logEntry('emailed', 'Krish', 'To a@b.com')).title).toBe('Emailed by Krish');
  });
});
