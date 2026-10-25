import { historyLabel } from '../freightView';
import { FIELD_LABELS } from '../../../accounting/freightRules';
import { formatCents } from '../../../accounting/money';
import type { Loose } from '../../../types/records';

const changeText = (c: Loose) => {
  const show = (v: unknown) => (c.field === 'amountCents' ? formatCents(v, { blank: 'no price' }) : (v === null || v === undefined || v === '' ? '—' : String(v)));
  return `${(FIELD_LABELS as Record<string, string>)[c.field] || c.field}: ${show(c.from)} → ${show(c.to)}`;
};

const when = (at: string | number | Date) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** The history lines, newest first, each with its own TX- id. */
export function HistoryList({ entries = [] }: { entries?: Loose[] }) {
  if (!entries.length) return <p style={{ margin: 0, color: 'var(--fr-muted)' }}>Nothing yet.</p>;
  return (
    <div>
      {entries.map((e) => (
        <div className="fr-ev" key={e.txnId || e._id}>
          <span className={`fr-ev-dot ${e.action === 'paid' ? 'paid' : e.action === 'approved' ? 'approved' : e.action === 'flagged' ? 'flagged' : ''}`} aria-hidden="true" />
          <div>
            <b>{historyLabel(e.action)}</b>
            <span className="fr-ev-meta"> · {e.by?.name || 'Delivery Schedule'} · {when(e.at)}</span>
            {e.note ? <div className="fr-ev-meta">{e.note}</div> : null}
            {e.action !== 'created' && (e.changes || []).filter((c: Loose) => c.field !== 'status').length > 0 ? (
              <div className="fr-ev-meta">
                {e.changes.filter((c: Loose) => c.field !== 'status').map(changeText).join('; ')}
              </div>
            ) : null}
            {e.txnId ? <span className="fr-tx fr-mono">{e.txnId}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
