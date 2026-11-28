import type { Loose } from '../../types/records';
import { useEffect, useRef, useState } from 'react';
import { X, Phone, Mail, MapPin, UserPlus, UserRound, Loader2, ChevronRight } from 'lucide-react';
import { getCompanyDetail, updateCompanyWork } from '../../api/projectLeads';
import {
  LEAD_STATUSES, STATUS_LABELS, formatPhone, formatValue, formatDayShort, contactName, customerPrefillForCompany,
  type LeadStatus
} from '../../utils/projectLeads';
import { rolesText, projectsText, projectRolesText, type CompanyItem, type CompanyDetail as Detail, type CompanyPerson } from '../../utils/projectLeadCompanies';

type Props = {
  /** What the list already knew, so the header is there while the rest loads. */
  item: CompanyItem;
  canEdit: boolean;
  onChanged: (company: Detail) => void;
  onClose: () => void;
  onCreateCustomer?: ((values: Loose) => void) | null;
  /** Opens one of its projects (the Projects view's own card). */
  onOpenProject?: ((id: string) => void) | null;
};

/**
 * One company: its status, who has it and a note (its own, across every project), the people to contact with a way to
 * reach each, and every project it is on with the role it plays there. Same drawer as a project's (LeadDetail).
 */
export default function CompanyDetail({ item, canEdit, onChanged, onClose, onCreateCustomer = null, onOpenProject = null }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState('');
  const [note, setNote] = useState(item.note);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  const c = detail ?? item;

  useEffect(() => {
    let live = true;
    setDetail(null);
    setLoadError('');
    getCompanyDetail(item.key)
      .then((d) => { if (live) { setDetail(d); setNote(d.note); } })
      .catch((err) => { if (live) setLoadError((err as Error).message); });
    return () => { live = false; };
  }, [item.key]);

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
      const next = await updateCompanyWork(item.key, change);
      setDetail(next);
      setNote(next.note);
      onChanged(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  const place = [c.address, c.city, c.state, c.zip].filter(Boolean).join(', ');
  const customerFor = (p: CompanyPerson) => customerPrefillForCompany(
    { id: p.latest.id, title: p.latest.title, city: p.latest.city, state: p.latest.state },
    {
      companyId: c.key, name: c.name, role: p.roles[0] ?? '', group: c.roles[0] ?? 'contractor', address: c.address, city: c.city, state: c.state, zip: c.zip,
      firstName: p.firstName, lastName: p.lastName, phone: p.phone, email: p.email
    }
  );

  return (
    <div className="prj-drawer-wrap">
      <button type="button" className="prj-backdrop" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <aside className="prj-drawer" role="dialog" aria-modal="true" aria-label={c.name}>
        <header className="prj-drawer-head">
          <div className="prj-drawer-title">
            <h2>{c.name}</h2>
            <span className="prj-sub">{rolesText(c.roles)} · {projectsText(c.projects)}</span>
            {place ? (
              <a className="prj-addr" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`} target="_blank" rel="noopener noreferrer">
                <MapPin size={14} aria-hidden="true" />{place}
              </a>
            ) : null}
          </div>
          <button type="button" ref={closeRef} className="prj-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>

        <div className="prj-drawer-body">
          {error ? <div className="prj-error" role="alert">{error}</div> : null}
          {loadError ? <div className="prj-error" role="alert">{loadError}</div> : null}

          <section className="prj-sec" aria-label="Follow-up">
            <h3>Where this lead stands</h3>
            <div className="prj-seg" role="group" aria-label="Status">
              {LEAD_STATUSES.map((s) => (
                <button key={s} type="button" className={`prj-seg-btn ${s}`} aria-pressed={c.status === s}
                  disabled={!canEdit || !!busy} onClick={() => c.status !== s && save('status', { status: s })}>
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
            <div className={`prj-assign${c.assignedTo ? ' has' : ''}`}>
              <UserRound size={18} aria-hidden="true" />
              <span className="prj-assign-text">
                <span className="prj-assign-label">{c.assignedTo ? 'Lead is with' : 'Nobody has this lead'}</span>
                {c.assignedTo ? <strong>{c.assignedTo}</strong> : null}
              </span>
              {(detail ?? item).canRelease ? (
                <button type="button" className="prj-btn sm" disabled={!!busy} onClick={() => save('assign', { assignedTo: '' })}>
                  {busy === 'assign' ? <Loader2 size={14} className="prj-spin" aria-hidden="true" /> : null}Release
                </button>
              ) : (detail ?? item).canTake ? (
                <button type="button" className="prj-btn sm prj-primary" disabled={!!busy} onClick={() => save('assign', { assignedTo: 'me' })}>
                  {busy === 'assign' ? <Loader2 size={14} className="prj-spin" aria-hidden="true" /> : null}Take this lead
                </button>
              ) : null}
            </div>
            {c.assignedTo && canEdit && !(detail ?? item).canRelease ? (
              <p className="prj-muted prj-assign-hint">Only {c.assignedTo} or their manager can release this lead.</p>
            ) : null}
            <label className="prj-note">
              <span>Note</span>
              <textarea value={note} rows={3} maxLength={2000} disabled={!canEdit} onChange={(e) => setNote(e.target.value)}
                placeholder="Who you spoke to, samples promised, what they need" />
            </label>
            {canEdit ? (
              <div className="prj-note-foot">
                <button type="button" className="prj-btn sm prj-primary" disabled={!!busy || note.trim() === c.note} onClick={() => save('note', { note })}>
                  {busy === 'note' ? 'Saving…' : 'Save note'}
                </button>
              </div>
            ) : null}
          </section>

          {!detail && !loadError ? <div className="prj-loading"><Loader2 size={24} className="prj-spin" aria-label="Loading" /></div> : null}

          {detail ? (
            <>
              <section className="prj-sec" aria-label="People">
                <h3>Who to contact <span className="prj-muted">· {detail.people.length}</span></h3>
                <ul className="prj-cos">
                  {detail.people.map((p) => {
                    const person = contactName(p);
                    return (
                      <li key={`${p.firstName}|${p.lastName}|${p.phone}|${p.email}`} className="prj-co">
                        <div className="prj-co-top">
                          <span className="prj-co-name">{person || 'No contact name'}</span>
                          <span className="prj-co-role">{projectRolesText(p.roles)}{p.projects > 1 ? ` · ${projectsText(p.projects)}` : ''}</span>
                        </div>
                        <div className="prj-co-actions">
                          {p.phone ? <a className="prj-chip" href={`tel:${p.phone}`}><Phone size={14} aria-hidden="true" />{formatPhone(p.phone)}</a> : null}
                          {p.email ? <a className="prj-chip" href={`mailto:${p.email}?subject=${encodeURIComponent('Easy Stones — stone samples')}`}><Mail size={14} aria-hidden="true" />{p.email}</a> : null}
                          {!p.phone && !p.email ? <span className="prj-muted">No phone or email in the export</span> : null}
                          {onCreateCustomer ? (
                            <button type="button" className="prj-chip prj-chip-btn" onClick={() => onCreateCustomer(customerFor(p))}>
                              <UserPlus size={14} aria-hidden="true" />Create customer
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="prj-sec" aria-label="Projects">
                <h3>Projects <span className="prj-muted">· {detail.projectList.length}</span></h3>
                <ul className="prj-projs">
                  {detail.projectList.map((p) => {
                    const where = [p.city, p.state].filter(Boolean).join(', ');
                    const body = (
                      <>
                        <span className="prj-name">{p.title}</span>
                        <span className="prj-sub">{projectRolesText(p.roles)}{where ? ` · ${where}` : ''}</span>
                        <span className="prj-sub">{[p.subcategory, p.units ? `${p.units} units` : '', p.stage, formatValue(p.value), formatDayShort(p.updatedOn)].filter((x) => x && x !== '—').join(' · ')}</span>
                      </>
                    );
                    return (
                      <li key={p.id}>
                        {onOpenProject
                          ? <button type="button" className="prj-proj" onClick={() => onOpenProject(p.id)}><span className="prj-proj-text">{body}</span><ChevronRight size={16} aria-hidden="true" /></button>
                          : <div className="prj-proj"><span className="prj-proj-text">{body}</span></div>}
                      </li>
                    );
                  })}
                </ul>
              </section>

              {detail.history.length ? (
                <section className="prj-sec" aria-label="History">
                  <h3>History</h3>
                  <ol className="prj-history">
                    {[...detail.history].reverse().map((h, i) => (
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
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
