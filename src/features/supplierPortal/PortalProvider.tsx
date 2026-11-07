import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { LANGUAGE_CODES, pickLanguage, t as translate } from '../../utils/supplierI18n';
import { setLanguage } from './portalApi';
import { PortalContext, type PortalValue } from './portalContext';
import type { PortalMe } from './types';

const LANG_KEY = 'esSupplierLang';

const startLang = () => {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && LANGUAGE_CODES.includes(saved)) return saved;
  } catch { /* storage off */ }
  return pickLanguage(typeof navigator !== 'undefined' ? navigator.languages : []);
};

/**
 * Who's signed in to the supplier portal and the language it speaks: their
 * login's, else the one they picked on this phone, else the phone's own.
 * Picking one saves it on the phone and, once signed in, on their login (the
 * emails follow it).
 */
export function PortalProvider({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<PortalMe | null>(null);
  const [lang, setLangState] = useState<string>(startLang);
  const setMe = useCallback((next: PortalMe | null) => {
    setMeState(next);
    if (next?.language && LANGUAGE_CODES.includes(next.language)) setLangState(next.language);
  }, []);
  const setLang = useCallback((next: string) => {
    if (!LANGUAGE_CODES.includes(next)) return;
    setLangState(next);
    try { localStorage.setItem(LANG_KEY, next); } catch { /* storage off */ }
    setMeState((m) => {
      if (m) setLanguage(next).catch(() => undefined);
      return m ? { ...m, language: next } : m;
    });
  }, []);
  const value = useMemo<PortalValue>(() => {
    const locale = lang === 'zh' ? 'zh-CN' : lang === 'pt' ? 'pt-BR' : lang;
    const rtf = typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl ? new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }) : null;
    return {
      me, setMe, lang, setLang,
      t: (key, vars) => translate(lang, key, vars),
      date: (day) => (day ? new Date(`${day}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''),
      ago: (iso) => {
        if (!iso || !rtf) return '';
        const min = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
        if (Math.abs(min) < 60) return rtf.format(min, 'minute');
        const h = Math.round(min / 60);
        if (Math.abs(h) < 24) return rtf.format(h, 'hour');
        return rtf.format(Math.round(h / 24), 'day');
      }
    };
  }, [me, setMe, lang, setLang]);
  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}
