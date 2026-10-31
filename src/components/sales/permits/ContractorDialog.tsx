import type { Loose } from '../../../types/records.ts';
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Copy, Check, ExternalLink, UserCheck, ArrowRight, RefreshCw } from 'lucide-react';
import FormModal from '../../shared/form/FormModal';
import { permitContractor } from '../../../api/permits';
import { SOURCES, formatPhone, categoryLabel } from '../../../permits/permitRules';
import { formatDay, formatMoney, licenseStanding, inForce, coverageLine, tradeLine, customerPrefillFor, personName, tidyName } from '../../../utils/permitView';

/*
 * One WA contractor in a popup (2026-10-14): what the state's L&I registry
 * says — license, trade, phone, insurance, bonds, principals — their permits
 * in the app, and whether they're already a customer. Opened from the
 * Permits search box (a license number + Enter) or a contractor's name on a
 * permit.
 *
 * Laid out as the approved Contractor pop-up design (the "Contractor pop-up
 * canvas" artifact — keep it in step with this file): on FormModal, the app's
 * form window, so it has the template's sizes, phone sheet, ✕ and footer.
 * Contact first, then their permits, then the state's record (insurance,
 * bond, principals), the license standing last. The footer holds the
 * "Verify on L&I" link and the one main button — Create customer, or Open
 * customer profile when they already are one. Looking up, not found and
 * failed each have their own screen.
 */

const L_AND_I = 'https://secure.lni.wa.gov/verify/';

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`pm-ct-field${wide ? ' wide' : ''}`}>
      <span className="pm-ct-label">{label}</span>
      {children}
    </div>
  );
}

function Coverage({ list, none }: { list: Loose[]; none: string }) {
  const { current, lapsed } = inForce(list);
  if (!list.length) return <span className="pm-ct-none">{none}</span>;
  return (
    <div className="pm-ct-cov">
      {current.map((x, i) => (
        <div key={`c${i}`} className="pm-ct-cov-item">
          <span>{coverageLine(x)}</span>
          {x.policy || x.account ? <span className="pm-ct-sub">{x.policy || x.account}</span> : null}
        </div>
      ))}
      {!current.length ? <div className="pm-ct-cov-warn"><AlertTriangle size={15} aria-hidden="true" />Nothing in force today</div> : null}
      {lapsed.slice(0, 2).map((x, i) => <span key={`l${i}`} className="pm-ct-sub">Lapsed: {coverageLine(x)}</span>)}
    </div>
  );
}

function CopyLicense({ license }: { license: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | number>(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(license);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked: the number is on screen to select */ }
  };
  return (
    <button type="button" className="pm-ct-copy" onClick={copy} aria-label={`Copy license ${license}`}>
      {license}
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      <span className="pm-ct-copied" role="status">{copied ? 'Copied' : ''}</span>
    </button>
  );
}

/*
 * Already a customer → "Open customer profile" (onOpenCustomer(id)); not yet →
 * "Create customer", which opens the Add customer form filled in from the
 * registry (onCreateCustomer(values) — absent for people who can't add one).
 */
export default function ContractorDialog({ license, onClose, onShowPermits = null, onLoaded = null, onOpenCustomer = null, onCreateCustomer = null }: { license: string; onClose: () => void; onShowPermits?: ((license: string, name: string) => void) | null; onLoaded?: ((data: Loose) => void) | null; onOpenCustomer?: ((id: string) => void) | null; onCreateCustomer?: ((value: Loose) => void) | null }) {
  const [state, setState] = useState<Loose>({ loading: true, data: null, error: '' });
  // What's looked up: starts as the license opened with; the not-found screen
  // lets a typo be fixed without closing. `attempt` re-runs the same lookup.
  const [lookup, setLookup] = useState(license);
  const [typed, setTyped] = useState(license);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ loading: true, data: null, error: '' });
    permitContractor(lookup)
      .then((data) => {
        if (!live) return;
        setState({ loading: false, data, error: '' });
        if (data.found) onLoaded?.(data.license, data.businessName);
      })
      .catch((err) => { if (live) setState({ loading: false, data: null, error: err.message }); });
    return () => { live = false; };
    // onLoaded is a fresh closure each render; the lookup follows the license only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup, attempt]);

  const { loading, data: d, error } = state;
  const standing = d ? licenseStanding(d) : null;
  const current = d ? (d.principals || []).filter((p) => !p.until) : [];
  const retry = () => setAttempt((n) => n + 1);
  const lookUpTyped = () => {
    const next = typed.trim().toUpperCase();
    if (!next) return;
    if (next === lookup) retry(); else setLookup(next);
  };

  // The one main button, by what the screen is.
  let primary = null;
  if (d?.found) {
    if (d.customer && onOpenCustomer) primary = { label: 'Open customer profile', run: () => onOpenCustomer(d.customer.id) };
    else if (!d.customer && onCreateCustomer) primary = { label: 'Create customer', run: () => onCreateCustomer(customerPrefillFor(d)) };
  }
  const onSubmit = () => {
    if (primary) primary.run();
    else if (d && !d.found) lookUpTyped();
  };

  const title = d?.found ? d.businessName : `License ${lookup}`;
  const verifyLabel = error ? 'Look it up on L&I’s site' : d && !d.found ? 'Search on L&I’s site' : 'Verify on L&I';
  const footerStart = (
    <a className="pm-ct-verify" href={d?.verifyUrl || L_AND_I} target="_blank" rel="noreferrer">
      <ExternalLink size={14} aria-hidden="true" />{verifyLabel}
    </a>
  );

  return (
    <FormModal
      title={title}
      size="m"
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel={primary?.label || ''}
      hideSubmit={!primary}
      footerStart={loading ? null : footerStart}
      footerNote={loading ? 'Checking the WA L&I registry…' : null}
    >
      <div className="pm-ct" aria-busy={loading ? 'true' : undefined}>
        {loading ? (
          <div className="pm-ct-skel" aria-hidden="true">
            <div className="b h42" /><div className="b w45" /><div className="b w80" /><hr />
            <div className="b w35 h12" /><div className="b h54" /><div className="b h54" />
          </div>
        ) : null}

        {error ? (
          <div className="pm-ct-banner err" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <span><b>Couldn’t look up this license</b><span>{error}</span></span>
            <button type="button" className="pm-ct-btn" onClick={retry}><RefreshCw size={15} aria-hidden="true" />Try again</button>
          </div>
        ) : null}

        {d && !d.found ? (
          <>
            <div className="pm-ct-banner warn" role="status">
              <AlertTriangle size={18} aria-hidden="true" /><span><b>Not in the state’s contractor registry</b></span>
            </div>
            <p className="pm-ct-plain">No contractor has this license number. Check it for a typo, or search by name on the state’s site.</p>
            <label className="pm-ct-field wide">
              <span className="pm-ct-label">License number</span>
              <span className="pm-ct-lookup">
                <input className="fm-input" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} />
                <button type="button" className="pm-ct-btn" onClick={lookUpTyped}>Look up</button>
              </span>
            </label>
          </>
        ) : null}

        {d?.found ? (
          <>
            {d.stale ? (
              <div className="pm-ct-banner info" role="status">
                <Clock size={16} aria-hidden="true" />
                <span>The state’s registry didn’t answer. This is the copy saved {formatDay(String(d.refreshedAt || '').slice(0, 10))}; insurance and bonds aren’t shown.</span>
                <button type="button" className="pm-ct-btn sm" onClick={retry}>Retry</button>
              </div>
            ) : null}

            {d.customer ? (
              <div className="pm-ct-customer">
                <UserCheck size={20} aria-hidden="true" />
                <span><b>Already a customer</b><span>{d.customer.name}</span></span>
              </div>
            ) : null}

            <section className="pm-ct-grid" aria-label="Contact">
              <Field label="Phone">
                {d.phone ? <a className="pm-ct-phone" href={`tel:${d.phone.replace(/[^\d+]/g, '')}`}>{formatPhone(d.phone)}</a> : <span className="pm-ct-none">None on file</span>}
              </Field>
              <Field label="Email">
                {d.emails?.length
                  ? <a className="pm-ct-mail" href={`mailto:${d.emails[0]}`}>{d.emails[0]}<span className="pm-ct-sub"> (from a permit)</span></a>
                  : <span className="pm-ct-none">None on file</span>}
              </Field>
              {d.address ? (
                <Field label="Address" wide>
                  <a className="pm-ct-addr" target="_blank" rel="noreferrer"
                    href={`https://maps.google.com/?q=${encodeURIComponent([d.address, d.city, d.state, d.zip].filter(Boolean).join(' '))}`}>
                    {[tidyName(d.address), tidyName(d.city), [d.state, d.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
                  </a>
                </Field>
              ) : null}
              {tradeLine(d) ? <Field label="License type"><span>{tradeLine(d)}</span></Field> : null}
              {d.ubi ? <Field label="State business ID (UBI)"><span>{d.ubi}</span></Field> : null}
            </section>
          </>
        ) : null}

        {d ? (
          <section className="pm-ct-block" aria-label="Their permits here">
            <div className="pm-ct-block-head">
              <span className="pm-ct-label">Permits here ({d.permits.total})</span>
              {d.permits.total && onShowPermits ? (
                <button type="button" className="pm-ct-btn sm" onClick={() => onShowPermits(d.license, d.businessName)}>
                  Show all {d.permits.total} in the list<ArrowRight size={14} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {d.permits.total ? (
              <>
                <div className="pm-ct-chips">
                  {d.permits.byCategory.map((c) => <span key={c.category} className="pm-ct-chip">{c.label || categoryLabel(c.category)} <b>{c.count}</b></span>)}
                </div>
                <ul className="pm-ct-permits">
                  {d.permits.recent.map((p) => (
                    <li key={p._id}>
                      <span className="pm-ct-when">{formatDay(p.issuedOn)}</span>
                      <span className="pm-ct-what">
                        <span className="pm-ct-addr-line">{[p.address, p.city].filter(Boolean).join(', ')}</span>
                        <span className="pm-ct-sub">{categoryLabel(p.category)} · {SOURCES[p.source]?.label}</span>
                      </span>
                      <span className="pm-ct-value">{p.valuation ? formatMoney(p.valuation) : ''}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : <p className="pm-ct-none">None in the permits the app pulls (King and Whatcom counties).</p>}
          </section>
        ) : null}

        {d?.found && !d.stale ? (
          <section className="pm-ct-block pm-ct-grid" aria-label="Standing with the state">
            <Field label="Insurance"><Coverage list={d.insurance || []} none="No insurance on file with the state." /></Field>
            <Field label="Bond"><Coverage list={d.bonds || []} none="No bond on file with the state." /></Field>
            <Field label="Principals" wide>
              {current.length ? <span>{current.map((p) => personName(p.name)).join(' · ')}</span> : <span className="pm-ct-none">None listed.</span>}
            </Field>
          </section>
        ) : null}

        {d?.found ? (
          <div className={`pm-ct-standing ${standing.tone}`}>
            {standing.tone === 'ok' ? <CheckCircle2 size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
            <span className="pm-ct-standing-text">{standing.text}</span>
            <span className="pm-ct-standing-lic"><span>WA license</span><CopyLicense license={d.license} /></span>
          </div>
        ) : null}

        {d ? <p className="pm-ct-note">From the WA Department of Labor &amp; Industries’ contractor registry, updated daily.</p> : null}
      </div>
    </FormModal>
  );
}
