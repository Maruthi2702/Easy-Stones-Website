import React, { useMemo } from 'react';
import { Plus, Pencil, Trash2, BookUser } from 'lucide-react';
import { API_URL } from '../../../config/api';
import { formatPhoneForDisplay } from '../../../utils/phoneUtils';
import { companyOf, contactOf, realEmailsOf } from '../../../utils/customerList';
import { CopyButton } from './parts';
import './CustomerList.css';

/**
 * The profile's Contacts tab (2026-10-08, approved on the "Customer profile ·
 * Contacts tab with copy" canvas): every name, phone and email has a copy
 * button, so it can be pasted into an email, a text or another app.
 *
 * A table on a laptop; cards on an iPad (two across) and a phone (one across,
 * where the phone and email also call / email on tap). The main contact comes
 * first — it lives on the customer record (Contact name / Phone / Email in Edit
 * customer), so it has Save to phone but no edit or delete here.
 */

const saveHref = (customerId, key) =>
  `${API_URL}/api/customers/${customerId}/vcard?contact=${encodeURIComponent(key)}`;

const telHref = (phone) => `tel:${String(phone || '').replace(/[^\d+]/g, '')}`;

const CustomerContactsTab = ({ customer, onAdd, onEdit, onDelete }) => {
  const c = customer || {};

  const rows = useMemo(() => {
    const out = [];
    const name = contactOf(c);
    const emails = realEmailsOf(c);
    if (name || c.phone || emails.length) {
      out.push({
        key: 'primary',
        primary: true,
        name: name || companyOf(c),
        phone: c.phone || '',
        emails,
        role: 'Primary',
        notes: ''
      });
    }
    for (const ct of c.contacts || []) {
      out.push({
        key: ct._id,
        contact: ct,
        name: ct.name || '',
        phone: ct.phone || '',
        emails: ct.email ? [ct.email] : [],
        role: ct.role || '',
        notes: ct.notes || ''
      });
    }
    return out;
  }, [c]);

  // Plain render helpers, not components, so they don't remount on every render.
  const saveToPhone = (row, label) => (
    <a
      className={`cl-ib box cl-ct2-ic cl-ct2-save${label ? ' labelled' : ''}`}
      href={saveHref(c._id, row.key)}
      title="Save to phone contacts"
      aria-label={`Save ${row.name || 'contact'} to phone contacts`}
    >
      <BookUser size={16} aria-hidden="true" />{label ? <span className="cl-ct2-savelbl">Save to phone</span> : null}
    </a>
  );

  const editDelete = (row) => (row.primary ? null : (
    <>
      <button type="button" className="cl-ib box cl-ct2-ic cl-ct2-edit" aria-label={`Edit ${row.name || 'contact'}`} onClick={() => onEdit(row.contact)}>
        <Pencil size={15} aria-hidden="true" />
      </button>
      <button type="button" className="cl-ib box cl-ct2-ic cl-ct2-del" aria-label={`Delete ${row.name || 'contact'}`} onClick={() => onDelete(row.contact._id)}>
        <Trash2 size={15} aria-hidden="true" />
      </button>
    </>
  ));

  const phoneText = (p) => formatPhoneForDisplay(p) || p;

  return (
    <div className="cl cl-ct2">
      <div className="cl-ct2-head">
        <h3>Contacts</h3>
        <button type="button" className="cl-btn gold" onClick={onAdd}><Plus size={16} aria-hidden="true" />Add contact</button>
      </div>

      {rows.length === 0 ? (
        <div className="cl-sec cl-muted" style={{ textAlign: 'center' }}>No contacts added yet</div>
      ) : (
        <>
          {/* Laptop: the table. */}
          <div className="cl-sec cl-ct2-tablewrap">
            <table className="cl-ct2-table">
              <thead>
                <tr><th>Name</th><th>Phone</th><th>Email</th><th>Role</th><th>Notes</th><th className="r">Actions</th></tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.key}>
                    <td><span className="cl-ct2-val"><b>{row.name || '—'}</b><CopyButton value={row.name} what="name" always /></span></td>
                    <td><span className="cl-ct2-val">{row.phone ? <>{phoneText(row.phone)}<CopyButton value={phoneText(row.phone)} what="phone" always /></> : '—'}</span></td>
                    <td>
                      {row.emails.length ? row.emails.map(e => (
                        <span key={e} className="cl-ct2-val cl-ct2-block">{e}<CopyButton value={e} what="email" always /></span>
                      )) : '—'}
                    </td>
                    <td>{row.primary ? <span className="cl-ct2-pri">Primary</span> : (row.role || '—')}</td>
                    <td className="cl-muted">{row.notes || '—'}</td>
                    <td className="r"><span className="cl-ct2-acts">{saveToPhone(row)}{editDelete(row)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* iPad and phone: one card per person. */}
          <div className="cl-ct2-cards">
            {rows.map(row => (
              <article key={row.key} className="cl-sec cl-ct2-card" aria-label={row.name || 'Contact'}>
                <div className="cl-ct2-line">
                  <b className="cl-ct2-v cl-ct2-name">{row.name || '—'}</b>
                  {row.primary ? <span className="cl-ct2-pri">Primary</span> : (row.role ? <span className="cl-ct2-role">{row.role}</span> : null)}
                  <CopyButton value={row.name} what="name" always size={16} />
                </div>
                {row.phone && (
                  <div className="cl-ct2-line">
                    <span className="cl-ct2-k">Phone</span>
                    <a className="cl-ct2-v cl-ct2-link" href={telHref(row.phone)}>{phoneText(row.phone)}</a>
                    <CopyButton value={phoneText(row.phone)} what="phone" always size={16} />
                  </div>
                )}
                {row.emails.map(e => (
                  <div key={e} className="cl-ct2-line">
                    <span className="cl-ct2-k">Email</span>
                    <a className="cl-ct2-v cl-ct2-link" href={`mailto:${e}`}>{e}</a>
                    <CopyButton value={e} what="email" always size={16} />
                  </div>
                ))}
                {row.notes && (
                  <div className="cl-ct2-line">
                    <span className="cl-ct2-k">Notes</span>
                    <span className="cl-ct2-v cl-muted">{row.notes}</span>
                  </div>
                )}
                <div className="cl-ct2-cardacts">
                  {saveToPhone(row, true)}
                  {editDelete(row)}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default CustomerContactsTab;
