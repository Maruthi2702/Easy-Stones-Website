import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MIN_TRUCK_COL_WIDTH } from './boardRules';

type Args = {
  weekDates: string[];
  viewMode: string;
  /** Bumped by the toolbar's Today button. */
  todayRequest: number;
  todayStr: string;
  setSelectedDate: (date: string) => void;
};

/**
 * The board's scrolling (BoardGrid): today's row brought to the top, the
 * "more columns" fades and arrows, and the Today button — which also picks
 * today's pill on the cards view, during render as before. Its effects run in
 * the order they did inside BoardGrid.
 */
export function useBoardScroll({ weekDates, viewMode, todayRequest, todayStr, setSelectedDate }: Args) {
  // ── Open on today (2026-10-09) ──
  // The week table scrolls inside its own box (header and Day column pinned),
  // and puts today's row at the top: when the board appears, when the week
  // changes, and when Today is pressed. Never on a live update or after a
  // save — that would pull a dispatcher off the day they're working on. A
  // week without today starts at its first day.
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const showTodayRow = (behavior: ScrollBehavior = 'auto') => {
    const box = tableScrollRef.current;
    if (!box) return;
    const row = box.querySelector('tr.today-row');
    if (!row) { box.scrollTo({ top: 0, behavior }); return; }
    const head = box.querySelector('thead')?.getBoundingClientRect().height || 0;
    const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - head;
    box.scrollTo({ top: Math.max(0, top), behavior });
  };
  // Cards finish laying out after the jump (and a week can paint before its
  // tickets arrive), which moves today's row. So for a moment after a jump it
  // is kept lined up as the table resizes — until the person scrolls, clicks
  // or types, which always wins.
  const alignUntilRef = useRef(0);
  const jumpToToday = (behavior: ScrollBehavior) => {
    alignUntilRef.current = Date.now() + 2000;
    showTodayRow(behavior);
  };
  const weekKey = weekDates[0] || '';
  useLayoutEffect(() => { jumpToToday('auto'); }, [weekKey, viewMode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const box = tableScrollRef.current;
    const table = box?.querySelector('table');
    if (!box || !table || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => { if (Date.now() < alignUntilRef.current) showTodayRow('auto'); });
    ro.observe(table);
    const stop = () => { alignUntilRef.current = 0; };
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    events.forEach((ev) => box.addEventListener(ev, stop, { passive: true }));
    return () => {
      ro.disconnect();
      events.forEach((ev) => box.removeEventListener(ev, stop));
    };
  }, [viewMode]); // eslint-disable-line react-hooks/exhaustive-deps
  // ── More columns to the side (2026-10-15) ──
  // Scrollbars are hidden on most machines, so a board wider than the screen
  // gave no sign that Will Call (or a driver) was off to the right. Each side
  // that has more gets a fade and an arrow that scrolls one column over.
  const [moreSide, setMoreSide] = useState({ left: false, right: false });
  useEffect(() => {
    const box = tableScrollRef.current;
    if (!box) return undefined;
    const update = () => {
      const left = box.scrollLeft > 2;
      const right = box.scrollLeft + box.clientWidth < box.scrollWidth - 2;
      setMoreSide(prev => (prev.left === left && prev.right === right ? prev : { left, right }));
    };
    update();
    box.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(box);
    const table = box.querySelector('table');
    if (table) ro?.observe(table);
    return () => {
      box.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, [viewMode]);
  const scrollColumns = (dir: number) => {
    const box = tableScrollRef.current;
    if (!box) return;
    const col = box.querySelector('th.truck-col-header')?.getBoundingClientRect().width || MIN_TRUCK_COL_WIDTH;
    const end = box.scrollWidth - box.clientWidth;
    let left = box.scrollLeft + dir * col;
    // Less than half a column left over: go all the way, rather than leave a
    // sliver of Will Call needing a second click.
    if (end - left < col / 2) left = end;
    if (left < col / 2) left = 0;
    box.scrollTo({ left, behavior: 'smooth' });
  };

  // Today on phones/iPads (day pills): select today's pill, during render.
  const [seenTodayRequest, setSeenTodayRequest] = useState(todayRequest);
  if (todayRequest !== seenTodayRequest) {
    setSeenTodayRequest(todayRequest);
    if (weekDates.includes(todayStr)) setSelectedDate(todayStr);
  }
  const todayRequestRef = useRef(todayRequest);
  useEffect(() => {
    if (todayRequest === todayRequestRef.current) return;
    todayRequestRef.current = todayRequest;
    jumpToToday('smooth');
  }, [todayRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  return { tableScrollRef, moreSide, scrollColumns };
}
