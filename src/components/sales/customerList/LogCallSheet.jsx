import React, { useState } from 'react';
import { Phone, Check, PencilLine } from 'lucide-react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { companyOf, contactOf } from '../../../utils/customerList';

// The visit type a phone call is logged as — the app's own option for calls.
const CALL_VISIT_PURPOSE = 'Important Remote Meeting/Call';
const OUTCOMES = ['Talked', 'Left voicemail', 'No answer', 'Wrong number'];

/**
 * "Log this call?" — shown when someone comes back to the app after tapping
 * Call on a customer, so the call lands on the customer's Visits without them
 * having to remember to log it. Skip just dismisses.
 */
const LogCallSheet = ({ customer, userName, onDone, onSkip }) => {
  const [outcome, setOutcome] = useState('Talked');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (!customer) return null;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await authFetch(`${API_URL}/api/customers/${customer._id}/visits`, {
        method: 'POST',
        body: JSON.stringify({
          date: new Date().toLocaleDateString('en-CA'),
          purpose: CALL_VISIT_PURPOSE,
          outcome,
          notes: note.trim() ? `Phone call — ${note.trim()}` : 'Phone call'
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'Could not log the call. Try again.');
        return;
      }
      onDone();
    } catch {
      setError('Could not log the call. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const person = contactOf(customer);
  return (
    <>
      <div className="cl-scrim" onClick={onSkip} aria-hidden="true" />
      <section className="cl-sheet cl" role="dialog" aria-modal="true" aria-label="Log this call">
        <div className="cl-sheet-handle" aria-hidden="true" />
        <div style={{ padding: '10px 20px 4px', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--cl-ok-bg)', color: 'var(--cl-ok-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
            <Phone size={20} aria-hidden="true" />
          </span>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 19, fontWeight: 750 }}>Log this call?</h3>
            <div className="cl-sub" style={{ fontSize: 13 }}>{[companyOf(customer), person, 'just now'].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        <div className="cl-sheet-bd">
          <div className="cl-fl">How did it go?</div>
          <div className="cl-chips" role="radiogroup" aria-label="Call outcome">
            {OUTCOMES.map(o => (
              <button key={o} type="button" className="cl-chip" role="radio" aria-checked={outcome === o} aria-pressed={outcome === o} onClick={() => setOutcome(o)}>
                {outcome === o && <Check size={14} strokeWidth={2.5} aria-hidden="true" />}{o}
              </button>
            ))}
          </div>
          <label className="cl-search" style={{ width: '100%', height: 48, marginTop: 16 }}>
            <PencilLine size={16} aria-hidden="true" />
            <input type="text" className="no-capitalize" autoCapitalize="sentences" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a quick note (optional)" aria-label="Note (optional)" />
          </label>
          <div className="cl-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            Saved to this customer’s Visits as a call{userName ? ` by ${userName}` : ''}.
          </div>
          {error && <div className="cl-err" role="alert" style={{ marginTop: 8 }}>{error}</div>}
        </div>
        <div className="cl-sheet-ft">
          <button type="button" className="cl-btn" style={{ height: 48 }} onClick={onSkip} disabled={saving}>Skip</button>
          <button type="button" className="cl-btn gold" style={{ height: 48, flex: 1, justifyContent: 'center' }} onClick={save} disabled={saving}>
            <Check size={17} strokeWidth={2.5} aria-hidden="true" />{saving ? 'Saving…' : 'Save call'}
          </button>
        </div>
      </section>
    </>
  );
};

export default LogCallSheet;
