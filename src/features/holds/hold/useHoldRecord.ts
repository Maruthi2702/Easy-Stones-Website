import { useEffect, useState } from 'react';
import { getHold } from '../../../api/holds';
import type { Hold } from '../types';

/**
 * One hold, loaded by id (moved out of HoldPage, 2026-10-24); `reload` asks
 * again (after a save, so the history catches up, or when slabs changed
 * elsewhere). An answer for an id that's no longer shown is dropped.
 */
export function useHoldRecord(id: string) {
  const [hold, setHold] = useState<Hold | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    getHold(id)
      .then((h) => { if (live) { setHold(h as Hold); setError(''); } })
      .catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [id, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);
  return { hold, setHold, error, reload };
}
