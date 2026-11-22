import { useCallback, useEffect, useState } from 'react';
import { loadAccessLog } from './teamLocationApi';
import type { AccessEntry } from './types';

/** The access log (who looked at whose location). Read when the tab opens and on Refresh; newest first, the latest 500. */
export default function useAccessLog(active: boolean) {
  const [entries, setEntries] = useState<AccessEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setEntries((await loadAccessLog({ limit: 500 })).entries); setError(''); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (active) void refresh(); }, [active, refresh]);
  return { entries, loading, error, refresh };
}
