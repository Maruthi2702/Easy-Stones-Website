import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import useIsPhone, { prefersReducedMotion } from '../../components/shared/form/useIsPhone';
import { FormLayerContext } from '../../components/shared/form/formLayer';
import { lockPage, unlockPage } from '../../components/shared/pageLock';
import '../../components/shared/form/FormModal.css';
import { questionText } from './assistantMachine';
import type { Assistant } from './useAssistant';
import ConfirmView from './views/ConfirmView';
import type { EditTarget } from './views/ConfirmView';
import { ListenView, ThinkingView } from './views/ListenView';
import Logo from './views/Logo';
import PickView from './views/PickView';
import { ErrorView, PermissionView } from './views/ProblemViews';
import SavedBar from './views/SavedBar';
import { SearchView, TextEditView, TypedView } from './views/TypeSearchViews';
import './VoiceAssistant.css';

/** How far the handle must be dragged down before letting go closes the sheet (phones). */
const DRAG_CLOSE_PX = 90;

const CAPTION: Record<string, string> = {
  permission: 'Microphone', listening: 'Listening', thinking: 'Thinking', pick: 'Which one?', confirm: 'Check and save', saving: 'Saving',
  search: 'Find a customer', typing: 'Type it', error: 'Voice assistant', saved: 'Saved'
};

/**
 * The assistant's pop-up: a centred card on a tablet or computer, and on a phone a bottom sheet pinned to the screen
 * (CLAUDE.md, "Phones: pop-ups, sheets and the iPhone keyboard": never sized from visualViewport, the whole screen covered,
 * a drag outside the list moves nothing, the page locked, focus without scrolling, 16px text boxes). Boxes that take the keyboard
 * (typing, search, editing a note) are in a TALL sheet with the box at the top, so the keyboard covers only the bottom.
 *
 * Animations are `transform` / `opacity` only and stop under prefers-reduced-motion (VoiceAssistant.css). After Save the sheet
 * becomes a small bar that leaves the page usable (the visit is already in the list behind it).
 */
export default function AssistantSheet({ a }: { a: Assistant }) {
  const s = a.state;
  const phone = useIsPhone();
  const [edit, setEdit] = useState<EditTarget>(null);
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragFrom = useRef<number | null>(null);
  const setWrap = useCallback((el: HTMLDivElement | null) => { wrapRef.current = el; setLayer(el); }, []);

  const open = s.phase !== 'idle';
  const bar = s.phase === 'saved';
  const modal = open && !bar;
  const textEdit = s.phase === 'confirm' && (edit === 'notes' || edit === 'outcome' || edit === 'followUp') ? edit : null;
  const tall = phone && (s.phase === 'typing' || s.phase === 'search' || textEdit !== null);

  useEffect(() => { if (s.phase !== 'confirm') setEdit(null); }, [s.phase]);

  // Lock the page behind (so the keyboard can't scroll it), focus the sheet, give focus back on close.
  useEffect(() => {
    if (!modal) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    lockPage();
    sheetRef.current?.focus({ preventScroll: true });
    return () => { unlockPage(); previous?.focus?.({ preventScroll: true }); };
  }, [modal]);

  // Esc closes (or steps back), before anything under the sheet hears it — but not when it is meant for an open calendar.
  useEffect(() => {
    if (!modal) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if ((e.target as Element | null)?.closest?.('[data-fm-layer], .cal-pop')) return;
      e.stopPropagation();
      if (edit) setEdit(null);
      else if (s.phase === 'typing' || s.phase === 'search') a.back();
      else a.close();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [modal, edit, s.phase, a]);

  // A drag anywhere but a scrolling list moves nothing: not the page behind, and not the whole screen when the keyboard is up.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !modal) return undefined;
    let lastY = 0;
    const onStart = (e: TouchEvent) => { lastY = e.touches[0]?.clientY ?? 0; };
    const onMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? lastY;
      const dy = y - lastY;
      lastY = y;
      const list = (e.target as Element | null)?.closest?.('.va-scroll, .fm-sheet-body') as HTMLElement | null;
      if (list && list.scrollHeight > list.clientHeight + 1) {
        const atTop = list.scrollTop <= 0;
        const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
        if (!((dy > 0 && atTop) || (dy < 0 && atEnd))) return;
      }
      if (e.cancelable) e.preventDefault();
    };
    wrap.addEventListener('touchstart', onStart, { passive: true });
    wrap.addEventListener('touchmove', onMove, { passive: false });
    return () => { wrap.removeEventListener('touchstart', onStart); wrap.removeEventListener('touchmove', onMove); };
  }, [modal, layer]);

  // The voice level drives --lvl on the sheet (bars, logo pulse) a frame at a time, with no React renders.
  const hearing = s.phase === 'listening' || (s.phase === 'ask' && s.mic === 'on');
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!hearing || !wrap || prefersReducedMotion()) return undefined;
    let frame = 0;
    let level = 0;
    const tick = () => {
      level = level * 0.6 + a.levelRef.current * 0.4;
      wrap.style.setProperty('--lvl', level.toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); wrap.style.setProperty('--lvl', '0'); };
  }, [hearing, a.levelRef, layer]);

  // The phone sheet's handle: drag down past DRAG_CLOSE_PX and it closes; otherwise it springs back.
  const dragBy = (e: ReactPointerEvent) => Math.max(0, e.clientY - (dragFrom.current ?? e.clientY));
  const onGrabDown = (e: ReactPointerEvent<HTMLDivElement>) => { dragFrom.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId); sheetRef.current?.classList.add('is-dragging'); };
  const onGrabMove = (e: ReactPointerEvent<HTMLDivElement>) => { if (dragFrom.current !== null && sheetRef.current) sheetRef.current.style.transform = `translateY(${dragBy(e)}px)`; };
  const onGrabUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragFrom.current === null) return;
    const moved = dragBy(e);
    dragFrom.current = null;
    sheetRef.current?.classList.remove('is-dragging');
    if (moved > DRAG_CLOSE_PX) { a.close(); return; }
    if (sheetRef.current) sheetRef.current.style.transform = '';
  };

  if (!open) return null;

  if (bar) {
    return createPortal(<div ref={setWrap} className="va-wrap fm-tokens is-bar"><SavedBar a={a} /></div>, document.body);
  }

  const asking = s.phase === 'ask' ? questionText(s) : '';
  const announcement = s.phase === 'ask' ? asking : (CAPTION[s.phase] || '');
  let body;
  if (textEdit) body = <TextEditView key={textEdit} a={a} field={textEdit} onClose={() => setEdit(null)} />;
  else if (s.phase === 'permission') body = <PermissionView a={a} />;
  else if (s.phase === 'listening' || s.phase === 'ask') body = <ListenView a={a} />;
  else if (s.phase === 'thinking') body = <ThinkingView a={a} />;
  else if (s.phase === 'pick') body = <PickView a={a} />;
  else if (s.phase === 'confirm' || s.phase === 'saving') body = <ConfirmView a={a} edit={edit} setEdit={setEdit} />;
  else if (s.phase === 'search') body = <SearchView a={a} />;
  else if (s.phase === 'typing') body = <TypedView a={a} />;
  else body = <ErrorView a={a} />;

  const caption = s.phase === 'ask' && s.customer ? [s.customer.label, s.customer.city].filter(Boolean).join(' · ') : (CAPTION[s.phase] || '');

  return createPortal(
    <FormLayerContext.Provider value={layer}>
      <div ref={setWrap} className="va-wrap fm-tokens" data-phase={s.phase}>
        <button type="button" className="va-scrim" aria-label="Close the assistant" tabIndex={-1} onClick={a.close} />
        <div ref={sheetRef} className={`va-sheet${tall ? ' is-tall' : ''}`} role="dialog" aria-modal="true" aria-labelledby="va-caption" tabIndex={-1}>
          <div className="va-grab" aria-hidden="true" onPointerDown={onGrabDown} onPointerMove={onGrabMove} onPointerUp={onGrabUp} onPointerCancel={onGrabUp}><span /></div>
          <div className="va-head">
            <div className="va-caption" id="va-caption"><Logo spinning={hearing || s.phase === 'thinking' || s.phase === 'saving'} size={22} />{caption}</div>
            <button type="button" className="va-x" aria-label="Close" onClick={a.close}><X size={16} aria-hidden="true" /></button>
          </div>
          <div className="va-body va-scroll" key={`${s.phase}:${s.asking ?? ''}:${textEdit ?? ''}`}>{body}</div>
          <div className="va-sr" role="status" aria-live="polite">{announcement}</div>
        </div>
      </div>
    </FormLayerContext.Provider>,
    document.body
  );
}
