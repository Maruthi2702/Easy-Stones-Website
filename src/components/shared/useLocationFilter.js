import { useMemo, useState } from 'react';
import {
  locationNames, defaultLocationFor, defaultLocationsFor,
  resolveStoredLocation, resolveStoredLocations
} from '../../utils/locationFilter';

/**
 * The value behind a location filter: opens on the person's home location
 * (src/utils/locationFilter.js), and remembers a different pick for the rest
 * of the browser tab's session — per screen and per person, so switching
 * Delivery Schedule to Spokane leaves Sales Visits where it was, and the next
 * person to sign in on this tab still opens on their own home.
 *
 * The value is derived on every render rather than seeded once into state, so
 * options that arrive after the first render (most screens fetch the branch
 * list) still land on the home location instead of locking in All, and a
 * remembered pick the person has since lost access to quietly falls back.
 */

const storageKey = (screen, user) => `locationFilter:${screen}:${user?.id || user?._id || ''}`;

const readStored = (key) => {
  try {
    const raw = sessionStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
};

const writeStored = (key, value) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or blocked storage — the pick still holds until reload.
  }
};

/** A single-choice filter: [value, setValue], with '' meaning All locations. */
export const useLocationFilter = (screen, user, options) => {
  const key = storageKey(screen, user);
  const [picks, setPicks] = useState({});
  const names = locationNames(options);
  const picked = key in picks ? picks[key] : readStored(key);
  const value = resolveStoredLocation(picked, names) ?? defaultLocationFor(user, names);

  const setValue = (next) => {
    const v = typeof next === 'string' ? next : '';
    setPicks(p => ({ ...p, [key]: v }));
    writeStored(key, v);
  };

  return [value, setValue];
};

/**
 * A multi-choice filter: [values, setValues], with [] meaning All locations.
 * `defaultValues` replaces where it opens (normally just the home location)
 * for a screen with its own rule — Inventory's, which must not open on its
 * consignment sites (src/utils/inventoryLocations.js).
 */
export const useLocationsFilter = (screen, user, options, defaultValues = null) => {
  const key = storageKey(screen, user);
  const [picks, setPicks] = useState({});
  const names = locationNames(options);
  const picked = key in picks ? picks[key] : readStored(key);
  const resolved = resolveStoredLocations(picked, names)
    ?? (Array.isArray(defaultValues) ? defaultValues.filter(v => names.includes(v)) : defaultLocationsFor(user, names));

  // A fresh array every render would re-fire every effect that depends on it.
  const stable = JSON.stringify(resolved);
  const values = useMemo(() => JSON.parse(stable), [stable]);

  const setValues = (next) => {
    const v = Array.isArray(next) ? next : [];
    setPicks(p => ({ ...p, [key]: v }));
    writeStored(key, v);
  };

  return [values, setValues];
};
