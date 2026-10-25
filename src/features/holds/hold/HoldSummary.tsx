import { Timer, Phone, Mail } from 'lucide-react';
import { elapsedShare, longDate, dayMonth, dateOf, dateTimeOf, releaseDayOf, chanceText } from '../../../utils/holdView';
import type { Hold } from '../types';

type HoldSummaryProps = {
  hold: Hold;
  state: string;
  exp: { text: string; tone: string };
  act: { extend: boolean };
  now: Date;
  onExtend: () => void;
};

/** When the hold ends (and Extend), then who it's billed to and the hold's details. */
export default function HoldSummary({ hold, state, exp, act, now, onExtend }: HoldSummaryProps) {
  const c = hold.customer || {};
  return (
    <>
      {/* When it ends, and what happens then */}
      <div className={`hl-strip ${exp.tone}`}>
        <div className="hl-strip-main">
          {state === 'released' ? (
            <span><b>Released {dateOf(hold.releasedAt)}</b>{hold.releasedBy?.name ? ` by ${hold.releasedBy.name}` : ''}{hold.releaseReason ? ` — ${hold.releaseReason}` : ''}</span>
          ) : state === 'expired' ? (
            <span><b>Expired {longDate(hold.expiresOn)}</b> — the slabs stay held until {dayMonth(releaseDayOf(hold))}, then are released automatically.{act.extend ? ' Extend it to keep them.' : ''}</span>
          ) : (
            <>
              <span>Hold until <b>{longDate(hold.expiresOn)}</b></span>
              <span className={`hl-exp-chip ${exp.tone}`}>{exp.text}</span>
            </>
          )}
          {state === 'active' ? <span className="hl-bar" aria-hidden="true"><span style={{ width: `${Math.round(elapsedShare(hold, now) * 100)}%` }} /></span> : null}
        </div>
        {act.extend ? (
          <button type="button" className="hl-btn" onClick={onExtend}><Timer size={16} aria-hidden="true" />Extend</button>
        ) : null}
      </div>

      <div className="hl-cards2">
        <section className="hl-sec" aria-label="Bill to">
          <h3>Bill to</h3>
          <div className="hl-billto">
            <b>{c.name || '—'}</b>
            {c.address ? <span className="hl-addr">{c.address}</span> : null}
            {c.contact ? <span>{c.contact}</span> : null}
            <span className="hl-contact-links">
              {c.phone ? <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}><Phone size={14} aria-hidden="true" />{c.phone}</a> : null}
              {c.email ? <a href={`mailto:${c.email}`}><Mail size={14} aria-hidden="true" />{c.email}</a> : null}
            </span>
          </div>
        </section>
        <section className="hl-sec" aria-label="Hold">
          <h3>Hold</h3>
          <dl className="hl-kv">
            <dt>Job / reference</dt><dd>{hold.job || '—'}</dd>
            <dt>Chance to close</dt><dd>{chanceText(hold.chanceToClose)}</dd>
            <dt>Branch</dt><dd>{hold.branch}</dd>
            <dt>Sales rep</dt><dd>{hold.createdBy?.name || '—'}</dd>
            <dt>Created</dt><dd>{dateTimeOf(hold.createdAt)}</dd>
            {hold.updatedBy?.name && hold.updatedAt !== hold.createdAt ? <><dt>Last changed</dt><dd>{dateTimeOf(hold.updatedAt)} by {hold.updatedBy.name}</dd></> : null}
          </dl>
        </section>
      </div>
    </>
  );
}
