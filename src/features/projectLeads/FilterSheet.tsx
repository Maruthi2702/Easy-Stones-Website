import { useEffect, useRef } from 'react';
import { lockPage, unlockPage } from '../../components/shared/pageLock';

/**
 * Multifamily Leads' Filters on a phone (design: claude.ai artifact **Project Leads — all screen sizes**,
 * https://claude.ai/artifact/8jKDapsQW5FiLFj3875VCi, "Phone · filters"): a bottom sheet instead of the desktop's
 * floating panel. It follows CLAUDE.md's phone rules — pinned to the screen (never sized from visualViewport),
 * the page locked behind it, a drag outside its list moves nothing, Esc and the backdrop close it. The fields are
 * passed in, so the desktop panel and this sheet are the same fields.
 */
export default function FilterSheet({ count, noun = 'project', canClear, onClear, onClose, children }: {
  count: number | null;
  /** 'project' → "Show 12 projects"; 'compan' → "Show 12 companies". */
  noun?: 'project' | 'compan';
  canClear: boolean;
  onClear: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    lockPage();
    return () => unlockPage();
  }, []);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // A drag moves nothing unless the finger is in the list and the list can still scroll that way.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    let lastY = 0;
    const onStart = (e: TouchEvent) => { lastY = e.touches[0]?.clientY ?? 0; };
    const onMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? lastY;
      const dy = y - lastY;
      lastY = y;
      const list = (e.target as Element | null)?.closest?.('.prj-sheet-body') as HTMLElement | null;
      if (list && list.scrollHeight > list.clientHeight + 1) {
        const atTop = list.scrollTop <= 0;
        const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
        if (!((dy > 0 && atTop) || (dy < 0 && atEnd))) return;
      }
      if (e.cancelable) e.preventDefault();
    };
    wrap.addEventListener('touchstart', onStart, { passive: true });
    wrap.addEventListener('touchmove', onMove, { passive: false });
    return () => {
      wrap.removeEventListener('touchstart', onStart);
      wrap.removeEventListener('touchmove', onMove);
    };
  }, []);

  return (
    <div ref={wrapRef} className="prj-sheet-wrap">
      <button type="button" className="prj-backdrop" aria-label="Close filters" tabIndex={-1} onClick={onClose} />
      <section className="prj-sheet" role="dialog" aria-modal="true" aria-label="Filters">
        <div className="prj-sheet-grab" aria-hidden="true" />
        <div className="prj-sheet-head">
          <h2>Filters</h2>
          <button type="button" className="prj-sheet-clear" onClick={onClear} disabled={!canClear}>Clear</button>
        </div>
        <div className="prj-sheet-body">{children}</div>
        <div className="prj-sheet-foot">
          <button type="button" ref={closeRef} className="prj-btn prj-primary prj-sheet-done" onClick={onClose}>
            {count == null ? 'Done' : `Show ${count.toLocaleString('en-US')} ${noun === 'compan' ? (count === 1 ? 'company' : 'companies') : `project${count === 1 ? '' : 's'}`}`}
          </button>
        </div>
      </section>
    </div>
  );
}
