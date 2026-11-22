import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { BellRing, RefreshCw, Search, Send } from 'lucide-react';
import { MESSAGE_MAX, cleanMessage } from '../../utils/pushSend';
import { loadPeople, sendNotification, type Person, type SendResult } from './notificationsApi';
import { groupByBranch, groupState, matchPeople, tickedLine, toggleGroup } from './notificationsView';
import './SendNotification.css';

/**
 * Admin → Send Notification (2026-11-21): a short message to the iPhones of people on the sender's
 * team. Rules: src/utils/pushSend.ts; API: /api/push-send (needs `send_notifications`). Only people
 * signed in to the iOS app with notifications allowed have a phone, so the rest are shown greyed.
 */
export default function SendNotificationPage({ sidebarToggle = null }: { sidebarToggle?: ReactNode }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await loadPeople();
      setPeople(data.people); setConfigured(data.configured); setError('');
      setSelected(prev => new Set([...prev].filter(id => data.people.some(p => p.id === id && p.phones > 0))));
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const groups = useMemo(() => groupByBranch(matchPeople(people, query)), [people, query]);
  const { problem } = cleanMessage(message);
  const canSend = !sending && selected.size > 0 && !problem && configured;

  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const send = async () => {
    if (!canSend) return;
    setSending(true); setResult(null); setError('');
    try {
      const r = await sendNotification([...selected], message);
      setResult(r);
      if (r.reached > 0) { setMessage(''); setSelected(new Set()); }
    } catch (e) { setError((e as Error).message); } finally { setSending(false); }
  };

  return (
    <div className="sn">
      <header className="sn-head">
        {sidebarToggle}
        <div className="sn-title">
          <h1>Send Notification</h1>
          <span>{loading ? 'Loading…' : `${people.filter(p => p.phones > 0).length} of ${people.length} people on your team have the app set up`}</span>
        </div>
        <button type="button" className="sn-btn" onClick={() => void refresh()} aria-label="Refresh" title="Refresh"><RefreshCw size={16} aria-hidden="true" /></button>
      </header>

      {error ? <div className="sn-note is-error" role="alert">{error}</div> : null}
      {!configured && !loading ? <div className="sn-note is-error" role="alert">Push notifications are not set up on the server yet.</div> : null}

      <div className="sn-body">
        <section className="sn-compose" aria-label="Message">
          <label htmlFor="sn-message">Message</label>
          <textarea id="sn-message" className="no-capitalize" rows={3} maxLength={MESSAGE_MAX} value={message} placeholder="Hi Maruthi"
            onChange={e => { setMessage(e.target.value); setResult(null); }} />
          <div className="sn-foot">
            <span className="sn-count">{message.length} / {MESSAGE_MAX}</span>
            <span className="sn-ticked">{tickedLine(selected.size)}</span>
            <button type="button" className="sn-send" disabled={!canSend} onClick={() => void send()}>
              <Send size={15} aria-hidden="true" /> {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
          {result ? (
            <div className={`sn-note ${result.reached > 0 ? 'is-ok' : 'is-error'}`} role="status">
              {result.line}{result.noPhone.length ? ` (${result.noPhone.join(', ')})` : ''}{result.failed ? ` Apple refused ${result.failed} phone${result.failed === 1 ? '' : 's'}.` : ''}
            </div>
          ) : null}
        </section>

        <section className="sn-people" aria-label="People">
          <div className="sn-search">
            <Search size={15} aria-hidden="true" />
            <input type="search" className="no-capitalize" value={query} placeholder="Search name, role or branch" onChange={e => setQuery(e.target.value)} aria-label="Search people" />
          </div>
          {groups.length === 0 && !loading ? <div className="sn-empty">No one matches.</div> : null}
          {groups.map(g => {
            const state = groupState(selected, g.people);
            return (
              <div key={g.branch} className="sn-group">
                <label className="sn-gh">
                  <input type="checkbox" checked={state === 'all'} disabled={g.people.every(p => p.phones === 0)}
                    ref={el => { if (el) el.indeterminate = state === 'some'; }}
                    onChange={() => setSelected(prev => toggleGroup(prev, g.people, state !== 'all'))} />
                  <b>{g.branch}</b>
                </label>
                {g.people.map(p => (
                  <label key={p.id} className={`sn-person${p.phones === 0 ? ' is-off' : ''}`}>
                    <input type="checkbox" checked={selected.has(p.id)} disabled={p.phones === 0} onChange={() => toggle(p.id)} />
                    <span className="sn-who"><b>{p.name}</b><span>{p.role.replace(/_/g, ' ')}</span></span>
                    {p.phones === 0 ? <span className="sn-nophone">No phone set up</span> : <BellRing size={14} aria-label="Phone set up" className="sn-ok" />}
                  </label>
                ))}
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
