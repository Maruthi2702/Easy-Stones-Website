import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, Check, Unlock, Mail, MailX, ArrowLeftRight, Clock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { authFetch } from '../../../api/authFetch';
import { API_URL } from '../../../config/api';
import { logWords } from '../../../utils/dailyReportLog';
import type { LogAction, ShownLogEntry } from '../../../utils/dailyReportLog';
import { longDate } from '../reportFigures';
import './ReportLogDialog.css';

const ICONS: Record<LogAction, LucideIcon> = {
  submitted: Check,
  auto_submitted: Clock,
  reopened: Unlock,
  emailed: Mail,
  email_failed: MailX,
  transfer_added: ArrowLeftRight
};

const stamp = (at: string | Date) => new Date(at).toLocaleString('en-US', {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
});

type LogState = { entries: ShownLogEntry[]; earlier: boolean; status: string };

/**
 * More → View Log: who submitted the day, who reopened it and why, every
 * email it sent and every transfer added after submit, oldest first. Read
 * fresh each time it opens (GET /api/daily-reports/:date/log), so it shows a
 * reopen made in another tab a minute ago.
 */
export default function ReportLogDialog({ date, location, onClose }: { date: string; location: string; onClose: () => void }) {
  const [log, setLog] = useState<LogState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authFetch(`${API_URL}/api/daily-reports/${date}/log?location=${encodeURIComponent(location)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Could not load the log.');
        if (!cancelled) setLog(data);
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Could not load the log.'); });
    return () => { cancelled = true; };
  }, [date, location]);

  return (
    <FormModal title={`Log · ${longDate(date)} · ${location}`} size="s" onClose={onClose} hideSubmit>
      {error ? (
        <div className="drl-note is-error" role="alert"><AlertCircle size={15} /> {error}</div>
      ) : !log ? (
        <div className="drl-note"><Loader2 size={16} className="drl-spin" /> Loading…</div>
      ) : log.entries.length === 0 ? (
        <div className="drl-note">
          {log.status === 'none'
            ? 'Nothing yet — this day has never been saved.'
            : 'Nothing yet — this day hasn’t been submitted.'}
        </div>
      ) : (
        <>
          <ol className="drl-list">
            {log.entries.map((entry, i) => {
              const Icon = ICONS[entry.action] || Clock;
              const { title, detail } = logWords(entry);
              return (
                <li key={`${entry.action}-${String(entry.at)}-${i}`} className={`drl-row is-${entry.action}`}>
                  <span className="drl-icon"><Icon size={14} /></span>
                  <span className="drl-text">
                    <strong>{title}</strong>
                    {detail && <span className="drl-detail">{detail}</span>}
                  </span>
                  <time className="drl-time" dateTime={new Date(entry.at).toISOString()}>{stamp(entry.at)}</time>
                </li>
              );
            })}
          </ol>
          {log.earlier && (
            <p className="drl-foot">
              Before Nov 4, 2026 a report only kept its latest submit and reopen, so earlier ones may be missing.
            </p>
          )}
        </>
      )}
    </FormModal>
  );
}
