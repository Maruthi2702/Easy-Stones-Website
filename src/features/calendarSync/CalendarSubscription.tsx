import React, { useEffect, useState } from 'react';
import { authFetch } from '../../api/authFetch';
import { API_URL } from '../../config/api';

export default function CalendarSubscription() {
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  async function load(signal?: AbortSignal, rotate = false) {
    setBusy(true);
    setError('');
    try {
      const response = await authFetch(`${API_URL}/api/calendar/subscription${rotate ? '/rotate' : ''}`, {
        method: rotate ? 'POST' : 'GET', signal
      });
      const body = await response.json();
      if (!response.ok || !body.path) throw new Error(body.message || 'Could not load the subscription link.');
      if (!signal?.aborted) setPath(body.path);
    } catch (err) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Could not load the subscription link.');
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, []);

  const url = path ? `${API_URL || window.location.origin}${path}` : '';
  return (
    <div>
      <h3>Apple Calendar (One-Way Feed)</h3>
      <p>Add a read-only subscription to Apple or Google Calendar. Keep this link private: anyone with it can read your schedule.</p>
      {error && <p role="alert">{error}</p>}
      {busy ? <p role="status">Loading subscription link…</p> : path && <>
        <input aria-label="Private calendar subscription link" type="text" readOnly value={url} style={{ width: '100%', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
          <button type="button" className="btn-secondary" onClick={async () => {
            try { await navigator.clipboard.writeText(url); } catch { setError('Could not copy the link. Select and copy it above.'); }
          }}>Copy link</button>
          <a className="btn-primary" href={url.replace(/^https?:/, 'webcal:')}>Subscribe in Apple Calendar</a>
          <button type="button" className="btn-secondary" onClick={() => {
            if (window.confirm('Replace your subscription link? Existing calendar subscriptions will stop updating until you add the new link.')) load(undefined, true);
          }}>Replace link</button>
        </div>
      </>}
      {!busy && !path && <button type="button" className="btn-secondary" onClick={() => load()}>Try again</button>}
      <p>In Google Calendar, open Other calendars → From URL and paste this link.</p>
    </div>
  );
}
