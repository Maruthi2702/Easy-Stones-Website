import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';
import { checkStatus } from '../../../utils/permitView';

const STATUS_ICON = { ok: CheckCircle2, warn: AlertTriangle, none: AlertTriangle, busy: Loader2 };

/** One accuracy check: its line, then what differed and the county's report, if any. */
function CheckItem({ check }) {
  const s = checkStatus(check);
  const search = check.method === 'search';
  const Icon = STATUS_ICON[s.tone] || AlertTriangle;
  return (
    <li className={`pm-dlg-item ${s.tone}`}>
      <Icon size={15} aria-hidden="true" />
      <div className="pm-dlg-body">
        <span className="pm-dlg-line">{s.text}</span>
        {check.missingFromApp?.length ? <span>{search ? 'Found by the separate search but not here' : 'In the county’s report but not here'}: {check.missingFromApp.join(', ')}</span> : null}
        {check.notFoundAgain?.length ? <span>Here but not found by the separate search: {check.notFoundAgain.join(', ')}</span> : null}
        {check.notInReport?.length ? <span>Here but not in the county’s report: {check.notInReport.join(', ')}</span> : null}
        {check.notInCountySearch?.length ? <span>In the report but missing from the county’s own search: {check.notInCountySearch.join(', ')}</span> : null}
        {check.datesMoved?.length ? <span className="pm-muted">Re-issued by the county after the report (shown here under the new date): {check.datesMoved.join(', ')}</span> : null}
        {check.notPublic?.length ? <span className="pm-muted">Not lead types, and hidden from the county’s public search: {check.notPublic.join(', ')}</span> : null}
        {check.reportUrl ? <a href={check.reportUrl} target="_blank" rel="noreferrer">{check.reportTitle || 'The county’s report'}</a> : null}
      </div>
    </li>
  );
}

/**
 * Permits → More → Detailed Checks: each source's last pull and every
 * accuracy check, in a popup. Portaled to document.body (with its own copy
 * of the .pm colour tokens in Permits.css) so it out-stacks the app's
 * sidebars and sticky headers wherever the Permits page is mounted.
 */
export default function ChecksDialog({ statuses, topChecks, olderChecks, onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const key = (c) => `${c.source}-${c.month}-${c.method}`;
  return createPortal(
    <div className="pm-dlg-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} className="pm-dlg" role="dialog" aria-modal="true" aria-labelledby="pm-dlg-title">
        <div className="pm-dlg-head">
          <h2 id="pm-dlg-title">Detailed Checks</h2>
          <button type="button" className="pm-dlg-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="pm-dlg-scroll">
          <section>
            <h3>Sources</h3>
            <ul className="pm-dlg-list">
              {statuses.map((s) => {
                const Icon = STATUS_ICON[s.tone] || AlertTriangle;
                return (
                  <li key={s.id} className={`pm-dlg-item ${s.tone}`}>
                    <Icon size={15} className={s.tone === 'busy' ? 'pm-spin' : ''} aria-hidden="true" />
                    <div className="pm-dlg-body">
                      <span className="pm-dlg-line">{s.text}{s.through || ''}</span>
                      {s.unsorted.length ? (
                        <span className="pm-dlg-warn">New building types not sorted yet: {s.unsorted.map((u) => `${u.type} (${u.count})`).join(', ')}.</span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
          <section>
            <h3>Accuracy checks</h3>
            {topChecks.length ? (
              <ul className="pm-dlg-list">{topChecks.map((c) => <CheckItem key={key(c)} check={c} />)}</ul>
            ) : <p className="pm-muted">No checks have run yet.</p>}
          </section>
          {olderChecks.length ? (
            <section>
              <h3>Earlier checks</h3>
              <ul className="pm-dlg-list">{olderChecks.map((c) => <CheckItem key={key(c)} check={c} />)}</ul>
            </section>
          ) : null}
          <p className="pm-dlg-note">The month so far is checked each morning by finding every lead permit a second, separate way. Once a month is over, the county’s own monthly report replaces that check for Whatcom County. Bellingham doesn’t publish one; besides the separate query, every pull must read as many permits as the city says it has, or it fails.</p>
        </div>
      </div>
    </div>,
    document.body
  );
}
