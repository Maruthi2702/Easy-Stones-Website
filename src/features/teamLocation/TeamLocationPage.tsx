import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Crosshair, MapPin, RefreshCw, Search } from 'lucide-react';
import { DatePicker } from '../../components/shared/calendar/Calendar';
import type { Loose } from '../../types/records';
import { canViewLocationAudit, canViewTeamLocations } from '../../utils/locationTracking';
import { canLocateOnRequest, requestLine } from '../../utils/locationRequests';
import { trackingDay } from '../../utils/locationTracking';
import TeamMap from './TeamMap';
import LocateDialog from './LocateDialog';
import AccessLogPanel from './AccessLogPanel';
import useLocate from './useLocate';
import useTeamLocation from './useTeamLocation';
import { attentionCount, deviceLine, filterPeople, gapText, initials, liveCount, sortPeople, trailSummary } from './teamLocationView';
import './TeamLocation.css';

/**
 * Admin → Team Location (2026-11-19): where the tracked reps and drivers on
 * the viewer's team are, and where one of them went on a day. The rules (7 AM –
 * 6 PM on the person's workdays, on the person's branch clock, 90 days kept) are
 * src/utils/locationTracking.ts; the data is GET /api/location-tracking/team
 * and /team/:userId. Opened by the `view_team_locations` switch.
 *
 * Location v2 (2026-11-22): the list refreshes every 15 s; a person who should be reporting but isn't
 * says why (battery, Low Power Mode, location set to While Using…); a trail is cut at gaps and the gaps
 * are listed; and an **Access log** tab (the `view_location_audit` switch) shows who looked at whom.
 */
export default function TeamLocationPage({ currentUser, sidebarToggle = null, isActive = true }: {
  currentUser: Loose | null; sidebarToggle?: ReactNode; isActive?: boolean;
}) {
  const canMap = canViewTeamLocations(currentUser);
  const canAudit = canViewLocationAudit(currentUser);
  const allowed = canMap || canAudit;
  const [tab, setTab] = useState<'map' | 'log'>(canMap ? 'map' : 'log');
  const [query, setQuery] = useState('');
  const [onlyAttention, setOnlyAttention] = useState(false);
  const t = useTeamLocation(canMap && isActive);
  const canLocate = canLocateOnRequest(currentUser);
  const everyone = useMemo(() => sortPeople(t.people), [t.people]);
  const people = useMemo(() => filterPeople(everyone, query, onlyAttention), [everyone, query, onlyAttention]);
  const selected = everyone.find((p) => p.id === t.selectedId) || null;
  const attention = attentionCount(everyone);
  const locate = useLocate(selected?.id || '', allowed && canLocate);
  const today = trackingDay(new Date(), selected?.branch || currentUser?.assignedLocations?.[0] || 'Seattle');

  const showLog = tab === 'log' || !canMap;
  if (!allowed) return <div className="tl"><div className="tl-empty"><h3>You can’t see your team’s locations</h3></div></div>;

  return (
    <div className="tl">
      <header className="tl-head">
        {sidebarToggle}
        <div className="tl-title">
          <h1>Team Location</h1>
          <span>{!canMap ? 'Who looked at whose location' : t.loading ? 'Loading…' : `${liveCount(everyone)} live · ${everyone.length} tracked on your team`}{canMap ? ' · 7 AM – 6 PM on workdays, branch time' : ''}</span>
        </div>
        {canMap && canAudit ? (
          <div className="tl-tabs" role="tablist" aria-label="Team Location views">
            <button type="button" role="tab" aria-selected={!showLog} onClick={() => setTab('map')}>Map</button>
            <button type="button" role="tab" aria-selected={showLog} onClick={() => setTab('log')}>Access log</button>
          </div>
        ) : null}
        {canMap && !showLog ? (
          <button type="button" className="tl-btn" onClick={() => void t.refresh()} aria-label="Refresh" title={t.updatedAt ? `Updated ${t.updatedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}` : 'Refresh'}>
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      {showLog ? <AccessLogPanel /> : <>
      {t.error ? <div className="tl-note is-error" role="alert">{t.error}</div> : null}

      <div className="tl-body">
        <aside className="tl-side" aria-label="People">
          <div className="tl-find">
            <label className="tl-search">
              <Search size={15} aria-hidden="true" />
              <input type="search" className="no-capitalize" placeholder="Search name, branch or role" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search people" />
            </label>
            <button type="button" className="tl-chip" aria-pressed={onlyAttention} onClick={() => setOnlyAttention((v) => !v)} disabled={!attention && !onlyAttention}>
              <AlertTriangle size={13} aria-hidden="true" /> Needs a look{attention ? ` (${attention})` : ''}
            </button>
          </div>
          {everyone.length === 0 && !t.loading ? (
            <div className="tl-empty">
              <h3>No one is being tracked on your team</h3>
              <span>Turn on “Share location” for a role in Roles &amp; Permissions.</span>
            </div>
          ) : people.length === 0 && !t.loading ? (
            <div className="tl-empty"><h3>No one matches</h3><span>Clear the search or the “Needs a look” filter.</span></div>
          ) : people.map((p) => (
            <button key={p.id} type="button" className="tl-person" aria-pressed={p.id === t.selectedId} onClick={() => t.select(p.id)}>
              <span className="tl-ini" aria-hidden="true">{initials(p.name)}</span>
              <span className="tl-who"><b>{p.name}</b><span>{p.role.replace(/_/g, ' ')} · {p.branch} · {p.ago}</span>{p.consentedAt ? null : <span className="tl-nocon">Hasn’t agreed to share location yet</span>}{p.quiet ? <span className="tl-quiet">{p.quiet.text}</span> : null}{deviceLine(p) ? <span className="tl-device">{deviceLine(p)}</span> : null}</span>
              <span className={`tl-dot is-${p.status}`} title={p.status === 'live' ? 'Seen in the last 10 minutes' : p.status === 'earlier' ? 'Seen earlier today' : 'No location today'} />
            </button>
          ))}
        </aside>

        <section className="tl-main">
          <div className="tl-bar">
            {selected ? (
              <>
                <div className="tl-pick"><MapPin size={15} aria-hidden="true" /><b>{selected.name}</b></div>
                <DatePicker id="tl-day" value={t.day || today} max={today} today={today} variant="field" ariaLabel="Day" onChange={(d) => t.setDay(d === today ? '' : d)} />
                <span className="tl-sum" role="status">
                  {t.trailLoading ? 'Loading the day…' : t.trailError ? t.trailError
                    : t.trail ? trailSummary(selected.name, selected.branch, t.trail.miles, t.trail.first, t.trail.last, t.trail.points.length) : ''}
                </span>
                {canLocate ? (
                  <button type="button" className="tl-locate" onClick={() => locate.setOpen(true)}
                    disabled={!selected.consentedAt || locate.current?.status === 'pending'}
                    title={selected.consentedAt ? 'Ask this phone for its location now, any hour' : `${selected.name} hasn’t agreed to the current wording yet`}>
                    <Crosshair size={15} aria-hidden="true" /> Locate now
                  </button>
                ) : null}
              </>
            ) : <span className="tl-sum">Pick a person to see where they went.</span>}
          </div>
          {selected && locate.current ? (
            <div className={`tl-ask is-${locate.current.status}`} role="status">
              {requestLine(selected.name, locate.current.status, locate.current.answeredAt ? new Date(locate.current.answeredAt) : null)}
              {locate.current.status === 'answered' && locate.current.accuracyM !== null ? ` Accurate to about ${Math.round(locate.current.accuracyM)} m.` : ''}
            </div>
          ) : null}
          {selected && canLocate && locate.log.length ? (
            <details className="tl-log">
              <summary>Location requests ({locate.log.length})</summary>
              <ul>
                {locate.log.map((r) => (
                  <li key={r.id}>
                    <b>{new Date(r.requestedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</b>
                    {' · '}{r.requestedByName || 'Someone'}{' · '}{r.reason}{' · '}{r.status === 'answered' ? 'answered' : r.status === 'pending' ? 'waiting' : 'no answer'}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {selected && t.trail?.gaps?.length ? (
            <details className="tl-log">
              <summary>No data for {t.trail.gaps.length} stretch{t.trail.gaps.length === 1 ? '' : 'es'} (phone off, no signal or battery died)</summary>
              <ul>{t.trail.gaps.map((g) => <li key={g.from}>{gapText(g, selected.branch)}</li>)}</ul>
            </details>
          ) : null}
          <TeamMap people={people} selectedId={t.selectedId} trail={t.trail} onSelect={t.select} requested={locate.current} />
        </section>
      </div>
      {locate.open && selected ? (
        <LocateDialog name={selected.name} sending={locate.sending} error={locate.error} onAsk={(reason) => void locate.ask(reason)} onClose={locate.closeDialog} />
      ) : null}
      </>}
    </div>
  );
}
