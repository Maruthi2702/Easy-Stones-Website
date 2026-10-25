import { useEffect, useRef, useState } from 'react';
import { slabStatuses } from '../../api/holds';
import { useCart } from './cartStore';
import type { SlabLock } from './types';

/** POST /api/holds/slabs/status, per slab key. */
type SlabStatuses = Record<string, { lock: SlabLock | null }>;

/**
 * Which of these slabs are on a hold right now ({ [slabKey]: lock }), for the
 * inventory screen's cart column. Fetched when the slabs shown change; after
 * that, when someone else holds or releases a slab (cartStore's
 * reservationsTick) only the slabs that changed are asked about, not the whole
 * list — unless the event didn't say which, then all of them.
 * An empty list asks for nothing.
 */
export default function useSlabLocks(slabKeys: string[]): Record<string, SlabLock> {
  const { reservationsTick, changedKeys } = useCart();
  const [locks, setLocks] = useState<Record<string, SlabLock>>({});
  const wanted = [...new Set(slabKeys)].sort().join('|');
  const handledTick = useRef(reservationsTick);

  // The list changed: ask about all of it.
  useEffect(() => {
    if (!wanted) return undefined;
    let live = true;
    slabStatuses(wanted.split('|'))
      .then((answer) => {
        const res = answer as SlabStatuses;
        if (!live) return;
        setLocks(Object.fromEntries(Object.entries(res).filter(([, v]) => v.lock).map(([k, v]) => [k, v.lock as SlabLock])));
      })
      .catch(() => { /* the column just shows no locks; the server still refuses a held slab */ });
    return () => { live = false; };
  }, [wanted]);

  // Someone changed some slabs: ask about those, and fold the answer in.
  useEffect(() => {
    if (!wanted || reservationsTick === handledTick.current) return undefined;
    handledTick.current = reservationsTick;
    const shown = new Set(wanted.split('|'));
    const asked = changedKeys.length ? changedKeys.filter((k) => shown.has(k)) : wanted.split('|');
    if (!asked.length) return undefined; // none of the slabs on this list changed
    let live = true;
    slabStatuses(asked)
      .then((answer) => {
        const res = answer as SlabStatuses;
        if (!live) return;
        setLocks((prev) => {
          const next = changedKeys.length ? { ...prev } : {};
          asked.forEach((k) => { delete next[k]; });
          Object.entries(res).forEach(([k, v]) => { if (v.lock) next[k] = v.lock; });
          return next;
        });
      })
      .catch(() => { /* as above */ });
    return () => { live = false; };
  }, [reservationsTick, changedKeys, wanted]);

  return wanted ? locks : {};
}
