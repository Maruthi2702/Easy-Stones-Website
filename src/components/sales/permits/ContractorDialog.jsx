import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, AlertTriangle, CheckCircle2, Phone, MapPin, ExternalLink, UserCheck, UserPlus, ShieldCheck, Landmark, Users, FileText, Mail } from 'lucide-react';
import { permitContractor } from '../../../api/permits';
import { SOURCES, formatPhone, categoryLabel } from '../../../permits/permitRules';
import { formatDay, formatMoney, licenseStanding, inForce, coverageLine, tradeLine, customerPrefillFor, personName, tidyName } from '../../../utils/permitView';

/*
 * One WA contractor in a popup (2026-10-14): what the state's L&I registry
 * says — license, trade, phone, insurance, bonds, principals — their permits
 * in the app, and whether they're already a customer. Opened from the
 * Permits search box (a license number + Enter) or a contractor's name on a
 * permit. Portaled to document.body like ChecksDialog, for the same reason.
 */

function Section({ icon, title, children }) {
  const Icon = icon;
  return (
    <section className="pm-ct-sec">
      <h3><Icon size={14} aria-hidden="true" />{title}</h3>
      {children}
    </section>
  );
}

function Coverage({ list, none }) {
  const { current, lapsed } = inForce(list);
  if (!list.length) return <p className="pm-muted">{none}</p>;
  return (
    <ul className="pm-ct-list">
      {current.map((x, i) => <li key={`c${i}`}>{coverageLine(x)}{x.policy || x.account ? <span className="pm-sub"> · {x.policy || x.account}</span> : null}</li>)}
      {!current.length ? <li className="pm-ct-warn"><AlertTriangle size={13} aria-hidden="true" />Nothing in force today</li> : null}
      {lapsed.slice(0, 2).map((x, i) => <li key={`l${i}`} className="pm-muted">Lapsed: {coverageLine(x)}</li>)}
    </ul>
  );
}

/*
 * Already a customer → "Open customer profile" (onOpenCustomer(id)); not yet →
 * "Create customer", which opens the Add customer form filled in from the
 * registry (onCreateCustomer(values) — absent for people who can't add one).
 */
export default function ContractorDialog({ license, onClose, onShowPermits = null, onLoaded = null, onOpenCustomer = null, onCreateCustomer = null }) {
  const dialogRef = useRef(null);
  const [state, setState] = useState({ loading: true, data: null, error: '' });

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    setState({ loading: true, data: null, error: '' });
    permitContractor(license)
      .then((data) => {
        if (!live) return;
        setState({ loading: false, data, error: '' });
        if (data.found) onLoaded?.(data.license, data.businessName);
      })
      .catch((err) => { if (live) setState({ loading: false, data: null, error: err.message }); });
    return () => { live = false; };
    // onLoaded is a fresh closure each render; the lookup follows the license only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [license]);

  const d = state.data;
  const standing = d ? licenseStanding(d) : null;
  const current = d ? (d.principals || []).filter((p) => !p.until) : [];

  return createPortal(
    <div className="pm-dlg-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} className="pm-dlg pm-ct" role="dialog" aria-modal="true" aria-labelledby="pm-ct-title">
        <div className="pm-dlg-head">
          <h2 id="pm-ct-title">{d?.found ? d.businessName : `License ${license}`}</h2>
          <button type="button" className="pm-dlg-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="pm-dlg-scroll">
          {state.loading ? <div className="pm-loading"><Loader2 size={26} className="pm-spin" aria-label="Looking up the license" /></div> : null}
          {state.error ? <div className="pm-error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{state.error}</span></div> : null}

          {d ? (
            <>
              <div className={`pm-ct-standing ${standing.tone}`}>
                {standing.tone === 'ok' ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
                <span>{standing.text}</span>
                <span className="pm-grow" />
                <span className="pm-ct-lic">WA license {d.license}</span>
              </div>
              {d.stale ? <p className="pm-muted pm-small">The state’s registry didn’t answer just now — this is the copy saved {formatDay(String(d.refreshedAt || '').slice(0, 10))}.</p> : null}

              {d.found ? (
                <div className="pm-ct-main">
                  {tradeLine(d) ? <div className="pm-ct-row">{tradeLine(d)}</div> : null}
                  {d.phone ? <a className="pm-ct-row pm-ct-link" href={`tel:${d.phone.replace(/[^\d+]/g, '')}`}><Phone size={14} aria-hidden="true" />{formatPhone(d.phone)}</a> : null}
                  {d.address ? <div className="pm-ct-row"><MapPin size={14} aria-hidden="true" />{[tidyName(d.address), tidyName(d.city), [d.state, d.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</div> : null}
                  {d.emails?.length ? <a className="pm-ct-row pm-ct-link" href={`mailto:${d.emails[0]}`}><Mail size={14} aria-hidden="true" />{d.emails[0]}<span className="pm-sub">&nbsp;(from a permit)</span></a> : null}
                  {d.ubi ? <div className="pm-ct-row pm-sub">State business ID (UBI) {d.ubi}</div> : null}
                  {d.customer ? (
                    <div className="pm-ct-actions">
                      <span className="pm-customer"><UserCheck size={13} aria-hidden="true" />Already a customer: {d.customer.name}</span>
                      {onOpenCustomer ? <button type="button" className="pm-btn sm" onClick={() => onOpenCustomer(d.customer.id)}>Open customer profile</button> : null}
                    </div>
                  ) : onCreateCustomer ? (
                    <div className="pm-ct-actions">
                      <button type="button" className="pm-btn sm pm-primary" onClick={() => onCreateCustomer(customerPrefillFor(d))}>
                        <UserPlus size={15} aria-hidden="true" />Create customer
                      </button>
                      <span className="pm-sub">Opens the Add customer form filled in from the state’s record{d.emails?.length ? '' : ' — add their email there; the state doesn’t list one'}.</span>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="pm-muted">The state has no contractor under this license number. Check it for a typo, or look it up on the state’s site below.</p>
              )}

              {d.found && !d.stale ? (
                <>
                  <Section icon={ShieldCheck} title="Insurance"><Coverage list={d.insurance || []} none="No insurance on file with the state." /></Section>
                  <Section icon={Landmark} title="Bond"><Coverage list={d.bonds || []} none="No bond on file with the state." /></Section>
                  <Section icon={Users} title="Principals">
                    {current.length ? <p className="pm-ct-plain">{current.map((p) => personName(p.name)).join(' · ')}</p> : <p className="pm-muted">None listed.</p>}
                  </Section>
                </>
              ) : null}

              <Section icon={FileText} title={`Their permits here (${d.permits.total})`}>
                {d.permits.total ? (
                  <>
                    <p className="pm-ct-plain">{d.permits.byCategory.map((c) => `${c.label || categoryLabel(c.category)} ${c.count}`).join(' · ')}</p>
                    <ul className="pm-ct-list">
                      {d.permits.recent.map((p) => (
                        <li key={p._id}>
                          <span className="pm-ct-when">{formatDay(p.issuedOn)}</span>
                          <span>{[p.address, p.city].filter(Boolean).join(', ')}</span>
                          <span className="pm-sub"> · {categoryLabel(p.category)}{p.valuation ? ` · ${formatMoney(p.valuation)}` : ''} · {SOURCES[p.source]?.label}</span>
                        </li>
                      ))}
                    </ul>
                    {onShowPermits ? (
                      <button type="button" className="pm-btn sm" onClick={() => onShowPermits(d.license, d.businessName)}>
                        Show all {d.permits.total} in the list
                      </button>
                    ) : null}
                  </>
                ) : <p className="pm-muted">None in the permits the app pulls (King and Whatcom counties).</p>}
              </Section>

              <a className="pm-source-link" href={d.verifyUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" />Open on the state’s “Verify a Contractor” site</a>
              <p className="pm-dlg-note">From the WA Department of Labor &amp; Industries’ contractor registry, updated daily.</p>
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
