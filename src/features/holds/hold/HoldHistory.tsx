import { historyLabel, changeText, visibleChanges, dateTimeOf } from '../../../utils/holdView';

/** A history entry (HoldHistory in src/holds/models.js). */
export type HistoryEntry = { _id: string; action: string; by?: { name?: string } | null; at: string; note?: string; [key: string]: unknown };

/** The History tab: every change, newest first. */
export default function HoldHistory({ entries }: { entries: HistoryEntry[] }) {
  if (!entries.length) return <p className="hl-muted">Nothing yet.</p>;
  return (
    <ol className="hl-history">
      {entries.map((e) => (
        <li key={e._id} className={`hl-ev ${e.action}`}>
          <span className="hl-ev-dot" aria-hidden="true" />
          <div>
            <b>{historyLabel(e.action)}</b>
            <span className="hl-muted"> · {e.by?.name || 'System'} · {dateTimeOf(e.at)}</span>
            {e.note ? <div className="hl-muted">{e.note}</div> : null}
            {visibleChanges(e).length ? <div className="hl-muted">{visibleChanges(e).map(changeText).join('; ')}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
