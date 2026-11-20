import type { Loose } from '../../types/records';
import { useEffect, useRef, useState } from 'react';
import { X, Phone, Mail, MapPin, UserPlus, UserRound, Loader2, ChevronDown } from 'lucide-react';
import { updateLead, type Lead } from '../../api/projectLeads';
import {
  LEAD_STATUSES, STATUS_LABELS, ROLE_GROUPS, ROLE_GROUP_LABELS, roleLabel, formatPhone, formatValue, formatDayShort,
  contactName, customerPrefillForCompany, type LeadCompany, type LeadStatus, type RoleGroup
} from '../../utils/projectLeads';

type Props = {
  lead: Lead;
  canEdit: boolean;
  onChanged: (lead: Lead) => void;
  onClose: () => void;
  onCreateCustomer?: ((values: Loose) => void) | null;
};

const mailto = (lead: Lead, c: LeadCompany) =>
  `mailto:${c.email}?subject=${encodeURIComponent(`Easy Stones — stone samples for ${lead.title}`)}`;

const directions = (lead: Lead) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(', '))}`;

function CompanyCard({ lead, c, onCreateCustomer }: { lead: Lead; c: LeadCompany; onCreateCustomer?: Props['onCreateCustomer'] }) {
  const person = contactName(c);
  const place = [c.address, c.city, c.state].filter(Boolean).join(', ');
  return (
    <li className="prj-co">
      <div className="prj-co-top">
        <span className="prj-co-name">{c.name}</span>
        <span className="prj-co-role">{roleLabel(c.role)}</span>
      </div>
      {person ? <div className="prj-co-person"><UserRound size={14} aria-hidden="true" />{person}</div> : null}
      {place ? <div className="prj-co-place">{place}</div> : null}
      <div className="prj-co-actions">
        {c.phone ? <a className="prj-chip" href={`tel:${c.phone}`}><Phone size={14} aria-hidden="true" />{formatPhone(c.phone)}</a> : null}
        {c.email ? <a className="prj-chip" href={mailto(lead, c)}><Mail size={14} aria-hidden="true" />{c.email}</a> : null}
        {!c.phone && !c.email ? <span className="prj-muted">No phone or email in the export</span> : null}
        {onCreateCustomer ? (
          <button type="button" className="prj-chip prj-chip-btn" onClick={() => onCreateCustomer(customerPrefillForCompany(lead, c))}>
            <UserPlus size={14} aria-hidden="true" />Create customer
          </button>
        ) : null}
      </div>
    </li>
  );
}

/** One project: its status, who has it and a note (saved to its history), the facts, and every company with a way to reach them. */
export default function LeadDetail({ lead, canEdit, onChanged, onClose, onCreateCustomer = null }: Props) {
  const [note, setNote] = useState(lead.note);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  // A different project (or a save elsewhere) resets the note box.
  const [seen, setSeen] = useState(`${lead.id}|${lead.note}`);
  if (seen !== `${lead.id}|${lead.note}`) { setSeen(`${lead.id}|${lead.note}`); setNote(lead.note); setError(''); }

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async (what: string, change: { status?: LeadStatus; note?: string; assignedTo?: string }) => {
    setBusy(what);
    setError('');
    try {
      onChanged(await updateLead(lead.id, change));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  const groups = ROLE_GROUPS.map((g) => ({ group: g as RoleGroup, list: lead.companies.filter((c) => c.group === g) })).filter((g) => g.list.length);
  const facts: [string, string][] = [
    ['Value', formatValue(lead.value)],
    ['Stage', lead.stage || '—'],
    ['Type', lead.subcategory || '—'],
    ['Units', lead.units != null ? String(lead.units) : '—'],
    ['Floors', lead.floors != null ? String(lead.floors) : '—'],
    ['Floor area', lead.floorArea != null ? `${lead.floorArea.toLocaleString('en-US')} ${lead.floorAreaUnit}`.trim() : '—'],
    ['Owner type', lead.ownerType || '—'],
    ['Bid date', formatDayShort(lead.bidDate)],
    ['Listed', formatDayShort(lead.listedOn)],
    ['Updated', formatDayShort(lead.updatedOn)]
  ];

  return (
    <div className="prj-drawer-wrap">
      <button type="button" className="prj-backdrop" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <aside className="prj-drawer" role="dialog" aria-modal="true" aria-label={lead.title}>
        <header className="prj-drawer-head">
          <div className="prj-drawer-title">
            <h2>{lead.title}</h2>
            <a className="prj-addr" href={directions(lead)} target="_blank" rel="noopener noreferrer">
              <MapPin size={14} aria-hidden="true" />{[lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ') || 'No address'}
            </a>
          </div>
          <button type="button" ref={closeRef} className="prj-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>

        <div className="prj-drawer-body">
          {error ? <div className="prj-error" role="alert">{error}</div> : null}

          <section className="prj-sec" aria-label="Follow-up">
            <h3>Where this lead stands</h3>
            <div className="prj-seg" role="group" aria-label="Status">
              {LEAD_STATUSES.map((s) => (
                <button key={s} type="button" className={`prj-seg-btn ${s}`} aria-pressed={lead.status === s}
                  disabled={!canEdit || !!busy} onClick={() => lead.status !== s && save('status', { status: s })}>
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
            <div className={`prj-assign${lead.assignedTo ? ' has' : ''}`}>
              <UserRound size={18} aria-hidden="true" />
              <span className="prj-assign-text">
                <span className="prj-assign-label">{lead.assignedTo ? 'Lead is with' : 'Nobody has this lead'}</span>
                {lead.assignedTo ? <strong>{lead.assignedTo}</strong> : null}
              </span>
              {lead.canRelease ? (
                <button type="button" className="prj-btn sm" disabled={!!busy} onClick={() => save('assign', { assignedTo: '' })}>
                  {busy === 'assign' ? <Loader2 size={14} className="prj-spin" aria-hidden="true" /> : null}Release
                </button>
              ) : lead.canTake ? (
                <button type="button" className="prj-btn sm prj-primary" disabled={!!busy} onClick={() => save('assign', { assignedTo: 'me' })}>
                  {busy === 'assign' ? <Loader2 size={14} className="prj-spin" aria-hidden="true" /> : null}Take this lead
                </button>
              ) : null}
            </div>
            {lead.assignedTo && canEdit && !lead.canRelease ? (
              <p className="prj-muted prj-assign-hint">Only {lead.assignedTo} or their manager can release this lead.</p>
            ) : null}
            <label className="prj-note">
              <span>Note</span>
              <textarea value={note} rows={3} maxLength={2000} disabled={!canEdit} onChange={(e) => setNote(e.target.value)}
                placeholder="Who you spoke to, samples promised, what they need" />
            </label>
            {canEdit ? (
              <div className="prj-note-foot">
                <button type="button" className="prj-btn sm prj-primary" disabled={!!busy || note.trim() === lead.note} onClick={() => save('note', { note })}>
                  {busy === 'note' ? 'Saving…' : 'Save note'}
                </button>
              </div>
            ) : null}
          </section>

          <section className="prj-sec" aria-label="Project">
            <h3>Project</h3>
            <dl className="prj-facts">
              {facts.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
            </dl>
            {lead.stageNote ? <p className="prj-muted">{lead.stageNote}</p> : null}
          </section>

          <section className="prj-sec" aria-label="Companies">
            <h3>Who to contact <span className="prj-muted">· {lead.companies.length}</span></h3>
            {!groups.length ? <p className="prj-muted">The export names no companies for this project.</p> : null}
            {groups.map(({ group, list }) => group === 'other' ? (
              <details key={group} className="prj-more">
                <summary><ChevronDown size={14} aria-hidden="true" />{ROLE_GROUP_LABELS[group]} <span className="prj-muted">· {list.length}</span></summary>
                <ul className="prj-cos">{list.map((c, i) => <CompanyCard key={`${c.companyId}-${i}`} lead={lead} c={c} onCreateCustomer={onCreateCustomer} />)}</ul>
              </details>
            ) : (
              <div key={group}>
                <h4>{ROLE_GROUP_LABELS[group]}</h4>
                <ul className="prj-cos">{list.map((c, i) => <CompanyCard key={`${c.companyId}-${i}`} lead={lead} c={c} onCreateCustomer={onCreateCustomer} />)}</ul>
              </div>
            ))}
          </section>

          {lead.history.length ? (
            <section className="prj-sec" aria-label="History">
              <h3>History</h3>
              <ol className="prj-history">
                {[...lead.history].reverse().map((h, i) => (
                  <li key={`${h.at}-${i}`}>
                    {h.event
                      ? <span className="prj-event">{h.event}</span>
                      : <span className={`prj-pill ${h.status}`}>{STATUS_LABELS[h.status] ?? h.status}</span>}
                    <span className="prj-muted">{h.by} · {new Date(h.at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    {h.note ? <p>{h.note}</p> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
