import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronLeft, Globe, X } from 'lucide-react';
import { LANGUAGES } from '../../utils/supplierI18n';
import { noteFor, type Note } from '../../utils/supplierBlocks';
import { lockPage, unlockPage } from '../../components/shared/pageLock';
import { usePortal } from './portalContext';

/** The dark bar at the top of every portal screen: back, title, the language. */
export function PortalHeader({ back, title, sub, right }: { back?: string; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  const { t, lang } = usePortal();
  const [picking, setPicking] = useState(false);
  return (
    <header className="spx-head">
      {back ? <Link to={back} className="spx-back" aria-label={t('back')}><ChevronLeft size={20} strokeWidth={2.4} /></Link> : null}
      <div className="spx-head-ttl">
        <h1>{title}</h1>
        {sub ? <span>{sub}</span> : null}
      </div>
      <div className="spx-head-tools">
        {right}
        <button type="button" className="spx-lang" aria-label={`${t('language')}: ${LANGUAGES.find((l) => l.code === lang)?.name}`} onClick={() => setPicking(true)}>
          <Globe size={15} aria-hidden="true" /> {lang.toUpperCase()}
        </button>
      </div>
      {picking ? <LanguageSheet onClose={() => setPicking(false)} /> : null}
    </header>
  );
}

/** Every language the portal speaks, each in its own words. */
export function LanguageSheet({ onClose }: { onClose: () => void }) {
  const { t, lang, setLang } = usePortal();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { lockPage(); first.current?.focus({ preventScroll: true }); return () => unlockPage(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="spx-sheet-wrap" role="dialog" aria-modal="true" aria-label={t('language')}>
      <div className="spx-scrim" onClick={onClose} aria-hidden="true" />
      <div className="spx-sheet">
        <div className="spx-sheet-h"><b>{t('language')}</b><button type="button" className="spx-x" aria-label={t('cancel')} onClick={onClose}><X size={18} /></button></div>
        <div className="spx-langs">
          {LANGUAGES.map((l, i) => (
            <button key={l.code} ref={i === 0 ? first : undefined} type="button" lang={l.code} className={`spx-langrow${l.code === lang ? ' is-on' : ''}`}
              onClick={() => { setLang(l.code); onClose(); }}>
              <span>{l.name}</span>{l.code === lang ? <Check size={18} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A note from Easy Stones in the supplier's language, with the original a tap away. */
export function NoteBox({ title, note }: { title: string; note: Note | null | undefined }) {
  const { t, lang } = usePortal();
  const [original, setOriginal] = useState(false);
  const shown = noteFor(note, lang);
  if (!shown) return null;
  return (
    <div className="spx-note">
      <span className="spx-note-k">{title}</span>
      <span lang={original || !shown.translated ? shown.fromLang : lang}>{original ? shown.original : shown.text}</span>
      {shown.translated ? (
        <span className="spx-sub">{t('translatedFrom')} · <button type="button" className="spx-link" onClick={() => setOriginal((v) => !v)}>{original ? t('showTranslation') : t('showOriginal')}</button></span>
      ) : null}
    </div>
  );
}

export function Bar({ ordered, approved, waiting }: { ordered: number; approved: number; waiting: number }) {
  const pct = (n: number) => (ordered ? Math.min(100, Math.round((n / ordered) * 100)) : 0);
  const a = pct(approved);
  return (
    <div className="spx-bar" aria-hidden="true">
      <span className="spx-bar-ok" style={{ width: `${a}%` }} />
      <span className="spx-bar-wait" style={{ width: `${Math.min(100 - a, pct(waiting))}%` }} />
    </div>
  );
}

export function Loading() {
  return <div className="spx-loading" aria-busy="true"><span className="spx-spin" /></div>;
}
