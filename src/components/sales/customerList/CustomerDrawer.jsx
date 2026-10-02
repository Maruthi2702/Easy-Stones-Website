import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, ChevronUp, ChevronDown, ExternalLink, Pencil, MoreHorizontal, Phone, Mail, Navigation,
  Users, Wrench, Presentation, Clock, NotebookPen, Check, Trash2, Copy, MapPin
} from 'lucide-react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { formatPhoneForDisplay } from '../../../utils/phoneUtils';
import {
  STATUSES, companyOf, cityOf, cityLineOf, streetOf, contactCard, initialsOf
} from '../../../utils/customerList';
import { StatusDot, LocationTag, RepBadge, TypeTag, CopyButton } from './parts';
import { useDismiss, copyText, peopleOf, telHref, directionsHref, anchoredMenuStyle } from './uiHelpers';
import SplitAction from './SplitAction';

const fmtDate = (d) => {
  if (!d) return '';
  const date = new Date(String(d).length === 10 ? `${d}T12:00:00` : d);
  return Number.isNaN(date.getTime()) ? String(d) : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const todayStr = () => new Date().toLocaleDateString('en-CA');

const CopyCard = ({ person }) => {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return undefined;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  const text = contactCard({ name: person.name, email: person.email, phone: formatPhoneForDisplay(person.phone) || person.phone });
  if (!text) return null;
  return (
    <button type="button" className="cl-btn sm" title={`Copies: ${text}`} onClick={async () => { if (await copyText(text)) setDone(true); }}>
      {done ? <Check size={13} strokeWidth={2.5} /> : <Copy size={13} />}{done ? 'Copied' : 'Copy card'}
    </button>
  );
};

const CustomerDrawer = ({
  customer, position, onPrev, onNext, onClose, onOpenProfile, onEdit, onDelete,
  onStatusChange, canEdit, canDelete, overlay
}) => {
  const [detail, setDetail] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState('');
  const menuRef = useRef(null);
  const closeRef = useRef(null);
  const [menuPos, setMenuPos] = useState(undefined);
  useDismiss(menuOpen, setMenuOpen, menuRef, { closeOnScroll: true });

  const id = customer?._id;
  useEffect(() => {
    if (!id) return undefined;
    // PartnersSheet remounts this per customer (key), so state starts fresh.
    let live = true;
    (async () => {
      try {
        const res = await authFetch(`${API_URL}/api/customers/${id}`);
        if (!live) return;
        if (!res.ok) { setLoadError('Could not load contacts and visits.'); return; }
        const data = await res.json();
        if (live) setDetail(data);
      } catch {
        if (live) setLoadError('Could not load contacts and visits.');
      }
    })();
    return () => { live = false; };
  }, [id]);

  // Focus the close button when a different customer opens, for keyboard users.
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, [id]);

  // The list row is the fast first paint; the full record fills in behind it.
  const c = useMemo(() => ({ ...customer, ...(detail || {}) }), [customer, detail]);
  const people = useMemo(() => peopleOf(customer || {}, detail), [customer, detail]);
  // For the Contacts list, extra addresses packed into the email field belong
  // on the primary contact's card, not as nameless contacts of their own.
  const cards = useMemo(() => {
    const extra = people.filter(p => p.role === 'Other email').map(p => p.email);
    return people
      .filter(p => p.role !== 'Other email')
      .map(p => (p.role === 'Primary' ? { ...p, moreEmails: extra } : p));
  }, [people]);

  const visits = useMemo(() => [...(detail?.visits || [])]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))), [detail]);
  const nextFollowUp = useMemo(() => {
    const today = todayStr();
    return visits.map(v => (typeof v.followUpDate === 'string' ? v.followUpDate.slice(0, 10) : ''))
      .filter(d => d && d >= today).sort()[0] || '';
  }, [visits]);

  if (!customer) return null;

  const binders = parseInt(c.modaBinder, 10) || 0;
  const directions = directionsHref(c);
  const street = streetOf(c);
  const cityLine = cityLineOf(c);
  const note = (c.quickNote || c.notes || '').trim();

  const changeStatus = async (next) => {
    if (!next || next === c.status) return;
    setStatusSaving(true);
    setStatusError('');
    const ok = await onStatusChange(customer._id, next);
    setStatusSaving(false);
    if (ok) setDetail(d => (d ? { ...d, status: next } : d));
    else setStatusError('Could not change the status. Try again.');
  };

  return (
    <>
      {overlay && <div className="cl-scrim" onClick={onClose} aria-hidden="true" />}
      <aside className="cl-drawer cl" role="dialog" aria-modal={overlay ? 'true' : 'false'} aria-label={`${companyOf(c)} details`}>
        <div className="cl-drawer-top">
          <button ref={closeRef} type="button" className="cl-ib" aria-label="Close details" onClick={onClose}><X size={20} /></button>
          <span className="cl-grow" />
          {position && <span className="cl-muted" style={{ fontSize: 12.5 }}>{position.index + 1} of {position.total}</span>}
          <button type="button" className="cl-ib" aria-label="Previous customer" disabled={!onPrev} onClick={onPrev}><ChevronUp size={18} /></button>
          <button type="button" className="cl-ib" aria-label="Next customer" disabled={!onNext} onClick={onNext}><ChevronDown size={18} /></button>
          <button type="button" className="cl-btn sm soft" onClick={() => onOpenProfile(customer)}>
            <ExternalLink size={15} aria-hidden="true" />Open profile
          </button>
          {canEdit && (
            <button type="button" className="cl-ib" aria-label="Edit customer" onClick={() => onEdit(customer)}><Pencil size={17} /></button>
          )}
          {canDelete && (
            <div className="cl-rowmenu" ref={menuRef}>
              <button type="button" className="cl-ib" aria-label="More actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={(e) => { setMenuPos(anchoredMenuStyle(e.currentTarget, { align: 'right', estHeight: 60 })); setMenuOpen(o => !o); }}>
                <MoreHorizontal size={18} />
              </button>
              {menuOpen && (
                <div className="cl-pop right" role="menu" style={{ minWidth: 190, ...menuPos }}>
                  <button type="button" role="menuitem" className="cl-opt danger" onClick={() => { setMenuOpen(false); onDelete(customer._id); }}>
                    <Trash2 size={16} aria-hidden="true" />Delete customer…
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="cl-drawer-body">
          <div className="cl-dh" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3>{companyOf(c)}</h3>
            </div>
            {canEdit ? (
              <label className="cl-pill" title="Change status" style={{ position: 'relative' }}>
                <StatusDot status={c.status} />
                {/* A real <select> laid over the pill: native picker on phones, keyboard-accessible everywhere. */}
                <select value={c.status || ''} disabled={statusSaving} onChange={(e) => changeStatus(e.target.value)} aria-label="Status" style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', cursor: 'pointer' }}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </label>
            ) : <StatusDot status={c.status} />}
          </div>
          <div className="cl-dh-meta" style={{ marginTop: -6 }}>
            <TypeTag type={c.customerType} />
            {(c.level || c.segment) && <span className="cl-lvl">{c.level || c.segment}</span>}
            {cityOf(c) && <span className="cl-dh-place" title={[streetOf(c), cityLine].filter(Boolean).join(', ')}><MapPin size={14} aria-hidden="true" /><span>{[cityOf(c), c.address?.state].filter(Boolean).join(', ')}</span></span>}
            <LocationTag customer={c} />
            <RepBadge name={c.salesRepName} />
          </div>
          {statusError && <div className="cl-err" role="alert">{statusError}</div>}

          <div className="cl-qa">
            <SplitAction icon={Phone} verb="Call" people={people} field="phone" hrefOf={telHref} />
            <SplitAction icon={Mail} verb="Email" people={people} field="email" hrefOf={(e) => `mailto:${e}`} />
            {directions && (
              <a className="cl-btn" href={directions} target="_blank" rel="noopener noreferrer"><Navigation size={16} aria-hidden="true" />Directions</a>
            )}
          </div>

          <section className="cl-sec" aria-label="Contacts">
            <h4><Users size={15} aria-hidden="true" />Contacts <span className="cl-plus" style={{ margin: 0 }}>{cards.length}</span></h4>
            {cards.map(p => (
              <div className="cl-ct" key={p.key}>
                <span className="cl-av lg" aria-hidden="true" style={{ width: 32, height: 32, fontSize: 12 }}>{initialsOf(p.name || p.email)}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="cl-ct-name">
                    <b style={{ fontWeight: 650, fontSize: 13.5 }}>{p.name || p.email}</b>
                    {p.role && <span className="cl-lvl" style={{ height: 20, fontSize: 11 }}>{p.role}</span>}
                    <span className="cl-grow" />
                    <CopyCard person={p} />
                  </div>
                  <div className="cl-ct-vals">
                    {p.phone && (
                      <span className="cl-cp"><a href={telHref(p.phone)}>{formatPhoneForDisplay(p.phone)}</a><CopyButton value={formatPhoneForDisplay(p.phone) || p.phone} what="phone" always /></span>
                    )}
                    {[p.email, ...(p.moreEmails || [])].filter(Boolean).map(email => (
                      <span className="cl-cp" key={email}><a href={`mailto:${email}`}>{email}</a><CopyButton value={email} what="email" always /></span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            {loadError && <div className="cl-err">{loadError}</div>}
          </section>

          <section className="cl-sec" aria-label="Account and address">
            <h4><Wrench size={15} aria-hidden="true" />Account &amp; address</h4>
            <dl className="cl-kv">
              <dt>Address</dt>
              <dd>
                {street || cityLine ? (
                  directions
                    ? <a href={directions} target="_blank" rel="noopener noreferrer">{street}{street && cityLine ? <br /> : null}{cityLine}</a>
                    : <>{street}<br />{cityLine}</>
                ) : <span className="cl-miss">No address</span>}
              </dd>
              <dt>Customer type</dt><dd>{c.customerType || 'Fabricator'}</dd>
              <dt>Level</dt><dd>{c.level || c.segment || '—'}</dd>
              <dt>Sales rep</dt><dd>{c.salesRepName || 'Unassigned'}</dd>
              <dt>Location</dt><dd><LocationTag customer={c} /></dd>
              {nextFollowUp && (<><dt>Follow-up</dt><dd>{fmtDate(nextFollowUp)}</dd></>)}
              <dt>Marketing email</dt><dd>{c.receiveMarketing === false ? 'Opted out' : 'Opted in'}</dd>
            </dl>
          </section>

          <section className="cl-sec" aria-label="Moda Resources">
            <h4><Presentation size={15} aria-hidden="true" />Moda Resources</h4>
            <div className="cl-tiles">
              <div className="cl-tile"><span className="cl-muted" style={{ fontSize: 12.5 }}>Display</span><b style={{ color: c.modaDisplay === 'Yes' ? 'var(--cl-ok-ink)' : 'var(--cl-muted)' }}>{c.modaDisplay === 'Yes' ? 'Installed' : 'None'}</b></div>
              <div className="cl-tile"><span className="cl-muted" style={{ fontSize: 12.5 }}>Binders</span><b>{binders}</b></div>
            </div>
          </section>

          <section className="cl-sec" aria-label="Recent visits">
            <h4>
              <Clock size={15} aria-hidden="true" />Recent visits
              <button type="button" className="act" onClick={() => onOpenProfile(customer)}>All visits <ExternalLink size={12} aria-hidden="true" /></button>
            </h4>
            {!detail && !loadError && <span className="cl-sk" style={{ width: '60%' }} />}
            {detail && visits.length === 0 && <div className="cl-muted" style={{ fontSize: 13.5 }}>No visits logged yet.</div>}
            {visits.slice(0, 3).map((v, i) => (
              <div className="cl-vis" key={v._id || i}>
                <span className="cl-vic" aria-hidden="true"><Clock size={16} /></span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                    {v.purpose || 'Visit'} <span className="cl-muted" style={{ fontWeight: 500 }}>· {fmtDate(v.date)}{v.createdByName ? ` · ${v.createdByName}` : ''}</span>
                  </div>
                  {(v.notes || v.outcome) && <div className="cl-muted" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{v.notes || v.outcome}</div>}
                </div>
              </div>
            ))}
          </section>

          <section className="cl-sec" aria-label="Notes">
            <h4><NotebookPen size={15} aria-hidden="true" />Notes</h4>
            {note ? <div className="cl-note">{note}</div> : <div className="cl-muted" style={{ fontSize: 13.5 }}>No notes yet.</div>}
          </section>
        </div>
      </aside>
    </>
  );
};

export default CustomerDrawer;
