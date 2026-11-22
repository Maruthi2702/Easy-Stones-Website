import { useCallback, useEffect, useRef, useState } from 'react';
import { loadTeam, loadTrail } from './teamLocationApi';
import type { TeamPerson, Trail } from './types';

/** How often the list refreshes while the page is open and the tab is showing (the map is live to within this). */
export const REFRESH_MS = 15 * 1000;
/** How often a trail for TODAY is re-read while it is open. */
export const TRAIL_REFRESH_MS = 60 * 1000;

/**
 * Team Location's state: the tracked people on the viewer's team and where each
 * was last seen today, and — once one is picked — that person's trail for a
 * day ('' = today on their branch's clock). Answers that arrive after the
 * pick or the day changed are ignored. The list polls every 15 s while the tab
 * is showing (never two requests at once), reads again the moment the tab comes
 * back, and keeps the last good list if one poll fails.
 */
export default function useTeamLocation(active = true) {
  const [people, setPeople] = useState<TeamPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [day, setDay] = useState('');
  const [trail, setTrail] = useState<Trail | null>(null);
  const [trailLoading, setTrailLoading] = useState(false);
  const [trailError, setTrailError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const trailRun = useRef(0);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const { people: list } = await loadTeam();
      setPeople(list); setError(''); setUpdatedAt(new Date());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, REFRESH_MS);
    const back = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', back);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', back); };
  }, [active, refresh]);

  /** `quiet`: re-read without the loading state (today's trail growing while it is open). */
  const readTrail = useCallback((id: string, d: string, quiet: boolean) => {
    const run = ++trailRun.current;
    if (!quiet) { setTrailLoading(true); setTrailError(''); }
    loadTrail(id, d)
      .then((t) => { if (run === trailRun.current) { setTrail(t); setTrailError(''); } })
      .catch((e) => { if (run === trailRun.current && !quiet) { setTrail(null); setTrailError((e as Error).message); } })
      .finally(() => { if (run === trailRun.current && !quiet) setTrailLoading(false); });
  }, []);

  useEffect(() => {
    if (!selectedId) { trailRun.current++; setTrail(null); setTrailError(''); setTrailLoading(false); return undefined; }
    readTrail(selectedId, day, false);
    // Today's trail keeps growing: re-read it quietly (each read is a line in the access log, so not faster than this).
    if (day) return undefined;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') readTrail(selectedId, day, true); }, TRAIL_REFRESH_MS);
    return () => clearInterval(timer);
  }, [selectedId, day, readTrail]);

  const select = useCallback((id: string) => setSelectedId((cur) => (cur === id ? '' : id)), []);

  return { people, loading, error, refresh, updatedAt, selectedId, select, day, setDay, trail, trailLoading, trailError };
}
