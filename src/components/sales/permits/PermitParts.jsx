import React, { useEffect, useState } from 'react';
import { ExternalLink, Phone, Mail, UserCheck, ArrowDown, ArrowUp, ArrowUpDown, Copy, Check, BadgeCheck } from 'lucide-react';
import { SOURCES, formatPhone } from '../../../permits/permitRules';
import {
  formatDay, formatMoney, sizeLine, leadContact, contactTitle, contactPerson, contactPhone, registryLine, customerOf, nextSort, ariaSort
} from '../../../utils/permitView';

/*
 * The Permits screen's pieces (PermitsTab.jsx): sortable column headers, a
 * row's lead contact, and an opened permit's details.
 */

/** A column header that sorts the list: first click highest / newest first, next click the other way. */
export function SortHeader({ column, label, sort, onSort, className = '' }) {
  const state = ariaSort(sort, column);
  const Icon = state === 'descending' ? ArrowDown : state === 'ascending' ? ArrowUp : ArrowUpDown;
  return (
    <th className={className} aria-sort={state}>
      <button type="button" className={`pm-sort${state !== 'none' ? ' on' : ''}`} onClick={() => onSort(nextSort(sort, column))}>
        {label}<Icon size={13} aria-hidden="true" />
      </button>
    </th>
  );
}

function ContactLinks({ contact }) {
  if (!contact) return null;
  const { phone, fromRegistry } = contactPhone(contact);
  return (
    <span className="pm-links">
      {phone ? (
        <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} onClick={(e) => e.stopPropagation()} title={fromRegistry ? 'From the WA contractor registry' : undefined}>
          <Phone size={13} aria-hidden="true" />{formatPhone(phone)}{fromRegistry ? <span className="pm-reg-tag">WA L&amp;I</span> : null}
        </a>
      ) : null}
      {contact.email ? <a href={`mailto:${contact.email}`} onClick={(e) => e.stopPropagation()}><Mail size={13} aria-hidden="true" />{contact.email}</a> : null}
    </span>
  );
}

export function LeadCell({ permit }) {
  const { contact, note } = leadContact(permit);
  const customer = customerOf(permit);
  return (
    <>
      {note ? <span className="pm-note-chip">{note}</span> : null}
      {contact ? (
        <>
          <span className="pm-name">{contactTitle(contact)}{note && contact.kind === 'owner' ? <span className="pm-role"> · owner</span> : null}</span>
          {contactPerson(contact) ? <span className="pm-sub">{contactPerson(contact)}</span> : null}
          <ContactLinks contact={contact} />
        </>
      ) : null}
      {customer ? <span className="pm-customer"><UserCheck size={13} aria-hidden="true" />Customer: {customer.name}</span> : null}
    </>
  );
}

/** The permit number, one click to copy — for pasting into the city's own search. */
function CopyNumber({ number }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return undefined;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(number); setDone(true); } catch { setDone(false); }
  };
  return (
    <button type="button" className="pm-copy" onClick={copy} aria-live="polite">
      {done ? <><Check size={13} aria-hidden="true" />Copied</> : <><Copy size={13} aria-hidden="true" />Copy {number}</>}
    </button>
  );
}

/** What the WA L&I contractor registry says about a contractor (matched by license, or by exact name). */
function RegistryNote({ contact }) {
  const r = contact.registry;
  const named = r.businessName && r.businessName.toUpperCase() !== String(contact.company || contact.name || '').toUpperCase();
  return (
    <span className="pm-registry">
      <BadgeCheck size={13} aria-hidden="true" />
      <span>
        WA L&amp;I registry{named ? <>: <strong>{r.businessName}</strong></> : null}
        {registryLine(r) ? ` · ${registryLine(r)}` : ''}
        {r.matchedBy === 'name' ? ' · matched by exact name' : ''}
      </span>
    </span>
  );
}

export function PermitDetail({ permit }) {
  const source = SOURCES[permit.source];
  return (
    <div className="pm-detail">
      <div className="pm-detail-main">
        <p className="pm-desc">{permit.description || 'No description given.'}</p>
        <dl className="pm-kv">
          <dt>Type</dt><dd>{permit.type}{permit.subtype && !permit.type.toUpperCase().endsWith(permit.subtype.toUpperCase()) ? ` · ${permit.subtype}` : ''}</dd>
          <dt>Status</dt><dd>{permit.status || '—'}</dd>
          <dt>Applied</dt><dd>{formatDay(permit.appliedOn) || '—'}</dd>
          <dt>Issued</dt><dd>{formatDay(permit.issuedOn)}</dd>
          {permit.finaledOn ? <><dt>Finaled</dt><dd>{formatDay(permit.finaledOn)}</dd></> : null}
          <dt>Value</dt><dd>{formatMoney(permit.valuation) || '—'}</dd>
          {sizeLine(permit) ? <><dt>Size</dt><dd>{sizeLine(permit)}</dd></> : null}
          {permit.parcel ? <><dt>Parcel</dt><dd>{permit.parcel}</dd></> : null}
          {permit.projectName ? <><dt>Project</dt><dd>{permit.projectName}</dd></> : null}
          <dt>From</dt><dd>{source?.long}</dd>
        </dl>
        {permit.sourceUrl ? (
          <a className="pm-source-link" href={permit.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" />{source?.siteLabel || 'Open on the permit site'}</a>
        ) : null}
        {!permit.sourceUrl && source?.lookup ? (
          <div className="pm-city-link">
            <a className="pm-source-link" href={source.lookup.url} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" />{source.lookup.label}</a>
            <CopyNumber number={permit.permitNumber} />
            <span className="pm-sub">{source.lookup.note}</span>
          </div>
        ) : null}
      </div>
      <div className="pm-detail-contacts">
        {(permit.contacts || []).length ? permit.contacts.map((c, i) => (
          <div key={i} className="pm-contact">
            <span className="pm-role-label">{c.role}</span>
            <span className="pm-name">{contactTitle(c)}</span>
            {contactPerson(c) ? <span className="pm-sub">{contactPerson(c)}</span> : null}
            <ContactLinks contact={c} />
            {c.address ? <span className="pm-sub">{c.address}</span> : null}
            {c.registry ? <RegistryNote contact={c} /> : c.license ? <span className="pm-sub">WA license {c.license}</span> : null}
            {c.customer ? <span className="pm-customer"><UserCheck size={13} aria-hidden="true" />Customer: {c.customer.name}</span> : null}
          </div>
        )) : (
          <p className="pm-muted">{source?.readsDetails && !permit.detailsAt ? 'Contacts not loaded yet — the next morning pull reads them.' : 'No contacts listed.'}</p>
        )}
        {source?.contactsNote && !source.phones ? <p className="pm-muted pm-small">{source.contactsNote}.</p> : null}
      </div>
    </div>
  );
}
