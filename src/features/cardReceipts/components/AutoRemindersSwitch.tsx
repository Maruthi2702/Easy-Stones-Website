import { useEffect, useState } from 'react';
import * as api from '../cardReceiptsApi';

/**
 * The switch for the hourly Missing-receipt emails and pushes. Off until someone turns it on. It lives in
 * Users & Roles → Roles → Credit Card Receipts (owner, 2026-11-25: moved off the Cards tab); it is one setting
 * for everyone, not a per-role switch. Only the Accounting and Admin roles show it (their Roles card) and the server
 * lets only an Accounting or Admin login read or change it (owner, 2026-11-25).
 */
export default function AutoRemindersSwitch() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api.getAutoReminders().then((r) => setOn(r.on)).catch((e) => setError((e as Error).message)); }, []);
  const flip = async () => {
    if (on === null || busy) return;
    if (!on && !window.confirm('Turn on automatic reminders? Every cardholder with a Missing receipt older than 2 days gets an email and a phone notification on the next hourly check, and managers, Accounting and Admins from day 3.')) return;
    setBusy(true); setError('');
    try { setOn((await api.setAutoReminders(!on)).on); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <label className="perm-form-row" style={{ cursor: on === null || busy ? 'default' : 'pointer' }}>
        <input type="checkbox" role="switch" checked={on === true} disabled={on === null || busy} onChange={flip} />
        <span className="perm-form-text">
          <span className="perm-form-label">Automatic missing-receipt reminders: {on === null ? '…' : on ? 'On' : 'Off'}</span>
          <span className="perm-form-desc">One setting for everyone. Emails and phone notifications on day 2 and day 3. Send reminder by hand always works.</span>
        </span>
      </label>
      {error ? <div className="fm-note-box" role="alert">{error}</div> : null}
    </>
  );
}
