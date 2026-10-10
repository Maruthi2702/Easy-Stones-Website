import { useEffect, useState } from 'react';
import { slabStatuses } from '../../../api/holds';
import { useCart } from './cartStore';

/**
 * Which of these slabs are on a hold right now ({ [slabKey]: lock }), for the
 * inventory screen's cart column. Refetched when the slabs shown change and
 * whenever anyone holds or releases a slab (cartStore's reservationsTick).
 * An empty list asks for nothing.
 */
export default function useSlabLocks(slabKeys) {
  const { reservationsTick } = useCart();
  const [locks, setLocks] = useState({});
  const wanted = [...new Set(slabKeys)].sort().join('|');

  useEffect(() => {
    if (!wanted) return undefined;
    let live = true;
    slabStatuses(wanted.split('|'))
      .then((res) => {
        if (!live) return;
        setLocks(Object.fromEntries(Object.entries(res).filter(([, v]) => v.lock).map(([k, v]) => [k, v.lock])));
      })
      .catch(() => { /* the column just shows no locks; the server still refuses a held slab */ });
    return () => { live = false; };
  }, [wanted, reservationsTick]);

  return wanted ? locks : {};
}
