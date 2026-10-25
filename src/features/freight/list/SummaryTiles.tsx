import { formatCents } from '../../../accounting/money';
import { FREIGHT_TABS, plural, tabCount } from '../freightView';
import type { Loose } from '../../../types/records';

/** The four tiles over the list: to approve, owed, paid, and what needs review (a button to the To approve tab). */
export function SummaryTiles({ summary, onReview }: { summary: Loose; onReview: () => void }) {
  return (
    <div className="fr-tiles">
      <div className="fr-tile">
        <span className="k">To approve</span>
        <span className="v">{formatCents(summary.draft?.cents || 0)}</span>
        <span className="s">{plural(summary.draft?.count || 0, 'charge')}{summary.missingPrice ? ` · ${summary.missingPrice} missing a price` : ''}</span>
      </div>
      <div className="fr-tile">
        <span className="k">Owed</span>
        <span className="v">{formatCents(summary.approved?.cents || 0)}</span>
        <span className="s">{plural(summary.approved?.count || 0, 'charge')} approved, not paid</span>
      </div>
      <div className="fr-tile">
        <span className="k">Paid</span>
        <span className="v">{formatCents(summary.paid?.cents || 0)}</span>
        <span className="s">{plural(summary.paid?.count || 0, 'charge')}</span>
      </div>
      {summary.flagged ? (
        <button type="button" className="fr-tile review" onClick={onReview}>
          <span className="k">Needs review</span>
          <span className="v">{summary.flagged}</span>
          <span className="s">Delivery changed or removed</span>
        </button>
      ) : (
        <div className="fr-tile">
          <span className="k">Needs review</span>
          <span className="v">0</span>
          <span className="s">Nothing flagged</span>
        </div>
      )}
    </div>
  );
}

/** To approve · Approved · Paid · All, each with its count (and the flagged count on To approve). */
export function StatusTabs({ tab, summary, onTab }: { tab: string; summary: Loose; onTab: (tab: string) => void }) {
  return (
    <div className="fr-tabs" role="tablist" aria-label="Charges">
      {FREIGHT_TABS.map((t) => (
        <button key={t.id} type="button" role="tab" className="fr-tab" aria-selected={tab === t.id} onClick={() => onTab(t.id)}>
          {t.label}
          <span className="fr-cnt">{tabCount(t.id, summary)}</span>
          {t.id === 'to_approve' && summary.flagged ? <span className="fr-cnt review" title={`${summary.flagged} need review`}>{summary.flagged} to review</span> : null}
        </button>
      ))}
    </div>
  );
}
