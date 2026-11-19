import { useCallback, useEffect, useRef, useState } from 'react';
import { loadTeam, loadTrail } from './teamLocationApi';
import type { TeamPerson, Trail } from './types';

/** How often the list refreshes while the page is open and the tab is showing. */
export const REFRESH_MS = 60 * 1000;

/**
 * Team Location's state: the tracked people on the viewer's team and where each
 * was last seen today, and — once one is picked — that person's trail for a
 * day ('' = today on their branch's clock). Answers that arrive after the
 * pick or the day changed are ignored.
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
  const trailRun = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const { people: list } = await loadTeam();
      setPeople(list); setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, refresh]);

  useEffect(() => {
    const run = ++trailRun.current;
    if (!selectedId) { setTrail(null); setTrailError(''); return; }
    setTrailLoading(true); setTrailError('');
    loadTrail(selectedId, day)
      .then((t) => { if (run === trailRun.current) setTrail(t); })
      .catch((e) => { if (run === trailRun.current) { setTrail(null); setTrailError((e as Error).message); } })
      .finally(() => { if (run === trailRun.current) setTrailLoading(false); });
  }, [selectedId, day]);

  const select = useCallback((id: string) => setSelectedId((cur) => (cur === id ? '' : id)), []);

  return { people, loading, error, refresh, selectedId, select, day, setDay, trail, trailLoading, trailError };
}
