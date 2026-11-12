/**
 * Places a rep types for Optimize route (home, a hotel…), remembered on this
 * device only so the next day starts with them in the list.
 */
export type SavedPlace = { id: string; label: string; address: string; lat: number; lng: number };

const KEY = 'pl_saved_places';
const MAX = 6;

export const readPlaces = (): SavedPlace[] => {
  try {
    const list = JSON.parse(window.localStorage.getItem(KEY) || '[]');
    return Array.isArray(list)
      ? list.filter((p) => p && typeof p.id === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lng)).slice(0, MAX)
      : [];
  } catch { return []; }
};

/** Add (or replace the same address), newest first, keeping the latest few. */
export const savePlace = (place: Omit<SavedPlace, 'id'>): SavedPlace[] => {
  const id = `place:${place.address.toLowerCase()}`;
  const next = [{ ...place, id }, ...readPlaces().filter((p) => p.id !== id)].slice(0, MAX);
  try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private window: not remembered */ }
  return next;
};

export const forgetPlace = (id: string): SavedPlace[] => {
  const next = readPlaces().filter((p) => p.id !== id);
  try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* as above */ }
  return next;
};
