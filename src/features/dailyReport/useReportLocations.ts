import { useState, useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';

/** Which branches this person may report on, and every branch for transfers. */
export function useReportLocations(setError: Dispatch<SetStateAction<string | null>>) {
  const [locations, setLocations] = useState<string[]>([]);
  // Every branch the company has, for the Transfer row's From/To pickers —
  // deliberately not scoped to `locations` above. Which branch's own report
  // this person may open is an access question; which branch a transfer can
  // go to isn't, so a Seattle-only user still needs Atlanta on this list.
  const [allLocations, setAllLocations] = useState<string[]>([]);
  const [canExportAll, setCanExportAll] = useState(false);

  useEffect(() => {
    let alive = true;
    authFetch(`${API_URL}/api/daily-reports/locations`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Could not load your branches.')))
      .then(data => {
        if (!alive) return;
        const list = data.locations || [];
        setLocations(list);
        setAllLocations(data.allLocations || []);
        setCanExportAll(Boolean(data.canExportAll));
      })
      .catch(err => alive && setError(err.message));
    return () => { alive = false; };
  }, [setError]); // a state setter, which never changes: this runs once, as before

  return { locations, allLocations, canExportAll };
}
