import React, { useMemo } from 'react';
import { Tag, Megaphone, NotebookPen, Lock, Globe } from 'lucide-react';
import { realEmailsOf } from '../../../utils/customerList';
import { profileStats } from './uiHelpers';
import './CustomerList.css';

/**
 * The profile's Details tab (2026-10-07, approved on the "Customer profile ·
 * Header + Details tab" canvas). The header only says who the customer is;
 * everything else that used to sit in the header or the dark "Details &
 * notes" panel lives here, without repeating anything the header shows:
 * the stats, pricing & Moda, marketing, the quick note, and — for admins —
 * account & security.
 *
 * Saving the note, resetting the password and activating/deactivating stay
 * SalesPage's (they were already there); this only lays them out.
 */
const CustomerDetailsTab = ({
  customer, detail, levelLabel,
  quickNote, onQuickNoteChange, onSaveQuickNote, savingNote, noteSaved,
  canManageAccount, accountStatus, onToggleActive,
  resetPassword, onResetPasswordChange, onResetPassword
}) => {
  const c = useMemo(() => ({ ...(customer || {}), ...(detail || {}) }), [customer, detail]);
  const stats = useMemo(() => profileStats(c), [c]);
  const statCells = [
    ['Last visit', stats.lastVisit], ['Visits · 12 mo', stats.visits12],
    ['Resources', stats.resources], ['Customer since', stats.since]
  ];
  const subscribed = c.receiveMarketing !== false;
  const marketingEmails = realEmailsOf({ email: c.marketingEmail || c.email });
  const active = c.isActive !== false;

  return (
    <div className="cl cl-dt">
      <section className="cl-sec cl-dt-stats" aria-label="Summary">
        {statCells.map(([label, s]) => (
          <div className="cl-dt-stat" key={label}>
            <span className="cl-muted" style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
            <span className="v">{s.value}</span>
            {s.sub && <span className="cl-sub" style={{ margin: 0 }}>{s.sub}</span>}
          </div>
        ))}
      </section>

      <div className="cl-dt-pair">
        <section className="cl-sec" aria-label="Pricing and Moda">
          <h4><Tag size={15} aria-hidden="true" />Pricing &amp; Moda</h4>
          <dl className="cl-kv">
            <dt>Price level</dt><dd>{levelLabel}</dd>
            <dt>Moda display</dt><dd>{c.modaDisplay || 'No'}</dd>
            <dt>Moda binders</dt><dd>{c.modaBinder || '0'}</dd>
          </dl>
        </section>
        <section className="cl-sec" aria-label="Marketing">
          <h4><Megaphone size={15} aria-hidden="true" />Marketing</h4>
          <dl className="cl-kv">
            <dt>Emails</dt><dd className={subscribed ? 'cl-dt-good' : ''}>{subscribed ? 'Subscribed' : 'Unsubscribed'}</dd>
            <dt>Send to</dt>
            <dd>{marketingEmails.length ? marketingEmails.map(e => <div key={e}>{e}</div>) : '—'}</dd>
          </dl>
        </section>
      </div>

      <section className="cl-sec" aria-label="Quick note">
        <h4><NotebookPen size={15} aria-hidden="true" />Quick note</h4>
        <label htmlFor="cl-dt-note" className="cl-sr">Quick note</label>
        <textarea
          id="cl-dt-note"
          className="cl-dt-note"
          placeholder="Write a quick note for this customer…"
          value={quickNote}
          onChange={(e) => onQuickNoteChange(e.target.value)}
          autoCapitalize="sentences"
        />
        <div className="cl-dt-note-foot">
          <span className="cl-muted" style={{ fontSize: 12.5 }}>
            {quickNote.length} characters{noteSaved ? ' · saved' : ''}
          </span>
          <button type="button" className="cl-btn gold sm" onClick={onSaveQuickNote} disabled={savingNote}>
            {savingNote ? 'Saving…' : 'Save note'}
          </button>
        </div>
      </section>

      {canManageAccount && (
        <section className="cl-sec cl-dt-admin" aria-label="Account and security">
          <h4>
            <Lock size={15} aria-hidden="true" />Account &amp; security
            <span className="cl-dt-badge">Admin only</span>
          </h4>
          {accountStatus && (
            <div className={accountStatus.type === 'error' ? 'cl-err' : 'cl-dt-ok'} role="status">{accountStatus.message}</div>
          )}
          <dl className="cl-dt-grid">
            <div><dt>Account</dt><dd>{active ? 'Active' : 'Deactivated'}</dd></div>
            <div><dt>Verified</dt><dd>{c.isVerified ? 'Yes' : 'No'}</dd></div>
            <div><dt>Login attempts</dt><dd>{c.loginAttempts || 0}</dd></div>
            <div><dt>Locked until</dt><dd>{c.lockUntil ? new Date(c.lockUntil).toLocaleString() : 'Not locked'}</dd></div>
            <div><dt>Recent IPs</dt><dd>{(c.loginIps || []).join(', ') || 'None recorded'}</dd></div>
            <div><dt>Customer ID</dt><dd style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>{c._id}</dd></div>
            <div className="wide"><dt>Map pin</dt><dd><Globe size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 4 }} />{c.geocode?.precision ? `${c.geocode.precision} · ` : ''}{c.geocode?.formattedAddress || 'Not placed on the map'}</dd></div>
          </dl>
          <div className="cl-dt-admin-row">
            <label htmlFor="cl-dt-pw" className="cl-sr">New password</label>
            <input
              id="cl-dt-pw"
              type="password"
              className="cl-dt-input"
              placeholder="New password"
              value={resetPassword}
              onChange={(e) => onResetPasswordChange(e.target.value)}
              autoComplete="new-password"
            />
            <button type="button" className="cl-btn sm" onClick={onResetPassword} disabled={!resetPassword.trim() || !c._id}>Set new password</button>
            <span className="cl-grow" />
            <button type="button" className="cl-btn sm cl-dt-danger" onClick={onToggleActive} disabled={!c._id}>
              {active ? 'Deactivate account' : 'Activate account'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
};

export default CustomerDetailsTab;
