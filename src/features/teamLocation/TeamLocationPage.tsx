import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import DashboardSearch from '../../components/shared/DashboardSearch';
import LocationFilter from '../../components/shared/LocationFilter';
import RepFilterPicker from '../../components/shared/form/RepFilterPicker';
import type { Loose } from '../../types/records';
import { canViewLocationAudit, canViewTeamLocations } from '../../utils/locationTracking';
import { canLocateOnRequest } from '../../utils/locationRequests';
import { canSendNotifications } from '../../utils/pushSend';
import { findStops } from '../../utils/locationStops';
import { trackingDay } from '../../utils/locationTracking';
import TeamMap from './TeamMap';
import LocateDialog from './LocateDialog';
import AccessLogPanel from './AccessLogPanel';
import PersonPanel from './PersonPanel';
import useLocate from './useLocate';
import useTeamLocation from './useTeamLocation';
import { deviceLine, filterPeople, initials, isUnagreed, liveCount, sortPeople, statusLabel } from './teamLocationView';
import type { PeopleFilter } from './teamLocationView';
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
  const [filter, setFilter] = useState<PeopleFilter>('all');
  // Who is ticked in Filters → People; null = everyone.
  const [picked, setPicked] = useState<string[] | null>(null);
  const t = useTeamLocation(canMap && isActive);
  const canLocate = canLocateOnRequest(currentUser);
  const canRemind = canSendNotifications(currentUser as never);
  const stops = useMemo(() => findStops((t.trail?.points ?? []).map((p) => ({ lat: p.lat, lng: p.lng, at: new Date(p.at) }))), [t.trail]);
  const everyone = useMemo(() => sortPeople(t.people), [t.people]);
  const peopleOptions = useMemo(() => [...everyone].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: p.name, location: p.branch })), [everyone]);
  const ticked = picked ?? everyone.map((p) => p.id);
  const togglePerson = (id: string) => {
    const next = ticked.includes(id) ? ticked.filter((v) => v !== id) : [...ticked, id];
    setPicked(next.length === everyone.length ? null : next);
  };
  const people = useMemo(() => filterPeople(everyone, query, filter).filter((p) => !picked || picked.includes(p.id)), [everyone, query, filter, picked]);
  const selected = everyone.find((p) => p.id === t.selectedId) || null;
  const locate = useLocate(selected?.id || '', allowed && canLocate);
  const today = trackingDay(new Date(), selected?.branch || currentUser?.assignedLocations?.[0] || 'Seattle');
  const narrowed = Boolean(query.trim()) || filter !== 'all' || picked !== null;

  const showLog = tab === 'log' || !canMap;
  if (!allowed) return <div className="tl"><div className="tl-empty"><h3>You can’t see your team’s locations</h3></div></div>;

  const statusChoices: [PeopleFilter, string][] = [['all', 'Everyone'], ['live', 'Live now'], ['attention', 'Needs a look'], ['unagreed', 'Hasn’t agreed yet']];
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

      {everyone.length === 0 && !t.loading ? (
        <div className="tl-empty">
          <h3>No one is being tracked on your team</h3>
          <span>Turn on “Share location” for a role in Roles &amp; Permissions.</span>
        </div>
      ) : (
        <div className={`tl-stage${selected ? ' has-panel' : ''}`}>
          <TeamMap people={people} selectedId={t.selectedId} trail={t.trail} stops={stops} onSelect={t.select} requested={locate.current} />

          <div className="tl-float">
            <div className="tl-controls">
              <DashboardSearch value={query} onChange={setQuery} label="Search people" placeholder="Search name, branch or role"
                count={`${people.length} of ${everyone.length}`} />
              <LocationFilter
                user={currentUser as never}
                active={filter !== 'all' || picked !== null} activeCount={(filter !== 'all' ? 1 : 0) + (picked !== null ? 1 : 0)}
                onClear={() => { setFilter('all'); setPicked(null); }} doneLabel={`Show ${people.length} of ${everyone.length}`}
              >
                <RepFilterPicker
                  label="People" options={peopleOptions} selected={ticked} onToggle={togglePerson} you={currentUser?.id || ''}
                  onAll={() => setPicked(null)} onNone={() => setPicked([])} searchPlaceholder="Search people"
                  summary={picked === null ? 'All people' : picked.length === 0 ? 'No one' : picked.length === 1 ? peopleOptions.find((o) => o.value === picked[0])?.label : `${picked.length} of ${everyone.length} people`}
                />
                <div className="lf-group" role="group" aria-label="Show">
                  <span className="lf-group-label">Show</span>
                  <div className="tl-opts">
                    {statusChoices.map(([key, label]) => (
                      <button key={key} type="button" className="tl-opt" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>
                    ))}
                  </div>
                </div>
              </LocationFilter>
            </div>
            {narrowed && !selected ? (
              <div className="tl-results" role="region" aria-label="People">
                {people.length === 0 ? <div className="tl-empty"><h3>No one matches</h3><span>Clear the search or the filters.</span></div>
                  : people.map((p) => (
                    <button key={p.id} type="button" className="tl-person" onClick={() => t.select(p.id)}>
                      <span className={`tl-ini is-${isUnagreed(p) ? 'none' : p.status}`} aria-hidden="true">{initials(p.name)}</span>
                      <span className="tl-who">
                        <span className="tl-row1"><b>{p.name}</b><span className={`tl-pill is-${isUnagreed(p) ? 'unagreed' : p.status}`}>{statusLabel(p)}</span></span>
                        <span className="tl-sub">{p.role.replace(/_/g, ' ')} · {p.branch}</span>
                        {p.quiet ? <span className="tl-quiet">{p.quiet.text}</span> : null}
                        {deviceLine(p) ? <span className="tl-device">{deviceLine(p)}</span> : null}
                      </span>
                    </button>
                  ))}
              </div>
            ) : null}
          </div>

          {!selected && !narrowed ? <div className="tl-hint" role="status">Tap a pin to see where someone went.</div> : null}

          {selected ? (
            <PersonPanel key={selected.id} person={selected} trail={t.trail} stops={stops} trailLoading={t.trailLoading} trailError={t.trailError}
              day={t.day} setDay={t.setDay} today={today} canLocate={canLocate} canRemind={canRemind} locate={locate} onClose={() => t.select(selected.id)} />
          ) : null}
        </div>
      )}
      {locate.open && selected ? (
        <LocateDialog name={selected.name} sending={locate.sending} error={locate.error} onAsk={(reason) => void locate.ask(reason)} onClose={locate.closeDialog} />
      ) : null}
      </>}
    </div>
  );
}
