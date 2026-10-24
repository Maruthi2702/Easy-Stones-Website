import { useState, useEffect, useRef } from 'react';

/**
 * One row per transfer at any width: when the Transfers panel is too narrow
 * for full branch names (a phone, or the half-width panel on a laptop), the
 * From/To boxes show codes ('SEA') and the cells tighten (is-compact).
 * Full branch names need about 570px for the Transfers row; under that the
 * route boxes switch to codes. Measured on the panel, not the screen.
 */
export function useCompactRoutes(hasReport: boolean, view: string) {
  const transferTableRef = useRef<HTMLTableElement>(null);
  const [compactRoutes, setCompactRoutes] = useState(false);
  useEffect(() => {
    const box = transferTableRef.current?.parentElement;
    if (!box || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setCompactRoutes(entry.contentRect.width < 570));
    ro.observe(box);
    return () => ro.disconnect();
  }, [hasReport, view]);
  return { transferTableRef, compactRoutes };
}
