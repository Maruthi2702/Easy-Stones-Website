import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { MapPin, RefreshCw } from 'lucide-react';
import { DatePicker } from '../../components/shared/calendar/Calendar';
import type { Loose } from '../../types/records';
import { canViewTeamLocations } from '../../utils/locationTracking';
import { trackingDay } from '../../utils/locationTracking';
import TeamMap from './TeamMap';
import useTeamLocation from './useTeamLocation';
import { initials, liveCount, sortPeople, trailSummary } from './teamLocationView';
import './TeamLocation.css';

/**
 * Admin → Team Location (2026-11-19): where the tracked reps and drivers on
 * the viewer's team are, and where one of them went on a day. The rules (7 AM –
 * 6 PM on the person's workdays, on the person's branch clock, 90 days kept) are
 * src/utils/locationTracking.ts; the data is GET /api/location-tracking/team
 * and /team/:userId. Opened by the `view_team_locations` switch.
 */
export default function TeamLocationPage({ currentUser, sidebarToggle = null, isActive = true }: {
  currentUser: Loose | null; sidebarToggle?: ReactNode; isActive?: boolean;
}) {
  const allowed = canViewTeamLocations(currentUser);
  const t = useTeamLocation(allowed && isActive);
  const people = useMemo(() => sortPeople(t.people), [t.people]);
  const selected = people.find((p) => p.id === t.selectedId) || null;
  const today = trackingDay(new Date(), selected?.branch || currentUser?.assignedLocations?.[0] || 'Seattle');

  if (!allowed) return <div className="tl"><div className="tl-empty"><h3>You can’t see your team’s locations</h3></div></div>;

  return (
    <div className="tl">
      <header className="tl-head">
        {sidebarToggle}
        <div className="tl-title">
          <h1>Team Location</h1>
          <span>{t.loading ? 'Loading…' : `${liveCount(people)} live · ${people.length} tracked on your team`} · 7 AM – 6 PM on workdays, branch time</span>
        </div>
        <button type="button" className="tl-btn" onClick={() => void t.refresh()} aria-label="Refresh" title="Refresh">
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </header>

      {t.error ? <div className="tl-note is-error" role="alert">{t.error}</div> : null}

      <div className="tl-body">
        <aside className="tl-side" aria-label="People">
          {people.length === 0 && !t.loading ? (
            <div className="tl-empty">
              <h3>No one is being tracked on your team</h3>
              <span>Turn on “Share location” for a role in Roles &amp; Permissions.</span>
            </div>
          ) : people.map((p) => (
            <button key={p.id} type="button" className="tl-person" aria-pressed={p.id === t.selectedId} onClick={() => t.select(p.id)}>
              <span className="tl-ini" aria-hidden="true">{initials(p.name)}</span>
              <span className="tl-who"><b>{p.name}</b><span>{p.role.replace(/_/g, ' ')} · {p.branch} · {p.ago}</span>{p.consentedAt ? null : <span className="tl-nocon">Hasn’t agreed to share location yet</span>}</span>
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
              </>
            ) : <span className="tl-sum">Pick a person to see where they went.</span>}
          </div>
          <TeamMap people={people} selectedId={t.selectedId} trail={t.trail} onSelect={t.select} />
        </section>
      </div>
    </div>
  );
}
