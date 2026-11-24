import { useState } from 'react';
import { Crosshair, X } from 'lucide-react';
import { DatePicker } from '../../components/shared/calendar/Calendar';
import { requestLine } from '../../utils/locationRequests';
import { reminderFor } from '../../utils/locationHealth';
import { durationText } from '../../utils/locationStops';
import type { Stop } from '../../utils/locationStops';
import { sendReminder } from './teamLocationApi';
import type useLocate from './useLocate';
import { clockText, deviceRows, gapText, initials, isUnagreed, statusLabel, trailSummary } from './teamLocationView';
import type { TeamPerson, Trail } from './types';

type Tab = 'day' | 'phone' | 'requests';

/**
 * The picked person: header, then Day (the date, what the day holds, the gaps), Phone (what their phone
 * last said about itself and why they may be quiet) and Requests (the "Locate now" log), with Locate now
 * pinned at the bottom. A side panel on a laptop, a bottom sheet on a phone (TeamLocation.css). Design: the
 * claude.ai artifact "Team Location redesign", 4B. Keyed by the person, so picking someone else starts on Day.
 */
export default function PersonPanel({ person, trail, stops, trailLoading, trailError, day, setDay, today, canLocate, canRemind, locate, onClose }: {
  person: TeamPerson; trail: Trail | null; stops: Stop[]; trailLoading: boolean; trailError: string;
  day: string; setDay: (d: string) => void; today: string; canLocate: boolean; canRemind: boolean;
  locate: ReturnType<typeof useLocate>; onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('day');
  const [reminder, setReminder] = useState<{ state: 'idle' | 'sending' | 'sent' | 'error'; text: string }>({ state: 'idle', text: '' });
  const remind = canRemind && person.quiet ? reminderFor(person.quiet.code) : null;
  const sendIt = async () => {
    if (!remind) return;
    setReminder({ state: 'sending', text: '' });
    try { const r = await sendReminder(person.id, remind.message); setReminder({ state: r.reached > 0 ? 'sent' : 'error', text: r.line }); }
    catch (e) { setReminder({ state: 'error', text: (e as Error).message }); }
  };
  const tabs: [Tab, string][] = [['day', 'Day'], ['phone', 'Phone'], ...(canLocate ? [['requests', 'Requests'] as [Tab, string]] : [])];
  const rows = deviceRows(person);
  return (
    <aside className="tl-panel" aria-label={`${person.name}`}>
      <div className="tl-grab" aria-hidden="true" />
      <div className="tl-panel-head">
        <span className={`tl-ini is-${isUnagreed(person) ? 'none' : person.status}`} aria-hidden="true">{initials(person.name)}</span>
        <div className="tl-panel-who">
          <b>{person.name}</b>
          <span>{person.role.replace(/_/g, ' ')} · {person.branch}</span>
        </div>
        <span className={`tl-pill is-${isUnagreed(person) ? 'unagreed' : person.status}`}>{statusLabel(person)}</span>
        <button type="button" className="tl-btn tl-x" onClick={onClose} aria-label="Close"><X size={18} aria-hidden="true" /></button>
      </div>
      {locate.current ? (
        <div className={`tl-ask is-${locate.current.status}`} role="status">
          {requestLine(person.name, locate.current.status, locate.current.answeredAt ? new Date(locate.current.answeredAt) : null)}
          {locate.current.status === 'answered' && locate.current.accuracyM !== null ? ` Accurate to about ${Math.round(locate.current.accuracyM)} m.` : ''}
        </div>
      ) : null}
      <div className="tl-ptabs" role="tablist" aria-label={`${person.name} details`}>
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      <div className="tl-panel-body">
        {tab === 'day' ? (
          <>
            <DatePicker id="tl-day" value={day || today} max={today} today={today} variant="field" ariaLabel="Day" onChange={(d) => setDay(d === today ? '' : d)} />
            <p className="tl-sum" role="status">
              {trailLoading ? 'Loading the day…' : trailError ? trailError
                : trail ? trailSummary(person.name, person.branch, trail.miles, trail.first, trail.last, trail.points.length) : ''}
            </p>
            {stops.length ? (
              <section aria-label="Stops">
                <h3 className="tl-h3">Stops ({stops.length})</h3>
                <ul className="tl-stops">
                  {stops.map((st) => (
                    <li key={st.from.toISOString()}><b>{clockText(st.from.toISOString(), person.branch)}</b> · Stopped {durationText(st.minutes)}<span> until {clockText(st.to.toISOString(), person.branch)}</span></li>
                  ))}
                </ul>
              </section>
            ) : null}
            {trail?.gaps?.length ? (
              <details className="tl-log">
                <summary>No data for {trail.gaps.length} stretch{trail.gaps.length === 1 ? '' : 'es'} (the app wasn't running — closed, or stopped by the phone — or the phone was off or its battery died)</summary>
                <ul>{trail.gaps.map((g) => <li key={g.from}>{gapText(g, person.branch)}</li>)}</ul>
              </details>
            ) : null}
          </>
        ) : null}
        {tab === 'phone' ? (
          <>
            {isUnagreed(person) ? <p className="tl-nocon">Hasn’t agreed to share location yet, so nothing is kept for them.</p> : null}
            {person.quiet ? <p className="tl-quiet-box">{person.quiet.text}</p> : null}
            {rows.length ? (
              <dl className="tl-rows">
                {rows.map((r) => <div key={r.key} className={`is-${r.tone}`}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}
              </dl>
            ) : <p className="tl-sum">Their phone hasn’t reported anything yet.</p>}
            {remind ? (
              <div className="tl-remind">
                <button type="button" className="tl-locate" onClick={() => void sendIt()} disabled={reminder.state === 'sending' || reminder.state === 'sent'}>
                  {reminder.state === 'sent' ? 'Reminder sent' : reminder.state === 'sending' ? 'Sending…' : remind.label}
                </button>
                <p className="tl-sum">Sends this to their phone: “{remind.message}”</p>
                {reminder.text ? <p className={reminder.state === 'error' ? 'tl-ask-error' : 'tl-sum'} role="status">{reminder.text}</p> : null}
              </div>
            ) : null}
          </>
        ) : null}
        {tab === 'requests' ? (
          locate.log.length ? (
            <>
              <h3 className="tl-h3">Location requests ({locate.log.length})</h3>
              <ul className="tl-reqs">
                {locate.log.map((r) => (
                  <li key={r.id}>
                    <b>{new Date(r.requestedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</b>
                    {' · '}{r.requestedByName || 'Someone'}{' · '}{r.reason}{' · '}{r.status === 'answered' ? 'answered' : r.status === 'pending' ? 'waiting' : 'no answer'}
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="tl-sum">No one has asked for {person.name}’s location yet.</p>
        ) : null}
      </div>
      {canLocate ? (
        <div className="tl-panel-foot">
          <button type="button" className="tl-locate" onClick={() => locate.setOpen(true)}
            disabled={!person.consentedAt || locate.current?.status === 'pending'}
            title={person.consentedAt ? 'Ask this phone for its location now, any hour' : `${person.name} hasn’t agreed to the current wording yet`}>
            <Crosshair size={15} aria-hidden="true" /> Locate now
          </button>
        </div>
      ) : null}
    </aside>
  );
}
