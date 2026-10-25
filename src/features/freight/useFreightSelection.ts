import { useState } from 'react';
import { isSelectable } from './freightView';
import type { CarrierGroup, FreightCharge } from './freightView';

/**
 * The ticked charges (by id), kept across pages until the view changes or an
 * action finishes. Only charges waiting for approval or approved can be ticked.
 */
export function useFreightSelection() {
  const [selected, setSelected] = useState(() => new Map<string, FreightCharge>());
  const clear = () => setSelected(new Map());

  const toggle = (c: FreightCharge) => setSelected((m) => {
    const next = new Map(m);
    if (next.has(c._id)) next.delete(c._id); else next.set(c._id, c);
    return next;
  });
  const toggleGroup = (g: CarrierGroup) => setSelected((m) => {
    const next = new Map(m);
    const rows = g.items.filter(isSelectable);
    const allOn = rows.length > 0 && rows.every((c) => next.has(c._id));
    for (const c of rows) { if (allOn) next.delete(c._id); else next.set(c._id, c); }
    return next;
  });
  const groupState = (g: CarrierGroup) => {
    const rows = g.items.filter(isSelectable);
    const on = rows.filter((c) => selected.has(c._id)).length;
    return { all: rows.length > 0 && on === rows.length, some: on > 0 && on < rows.length, none: rows.length === 0 };
  };

  return { selected, selectedList: [...selected.values()], clear, toggle, toggleGroup, groupState };
}

export type FreightSelection = ReturnType<typeof useFreightSelection>;
