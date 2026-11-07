import { createContext, useContext } from 'react';
import type { StringKey } from '../../utils/supplierI18n';
import type { PortalMe } from './types';

/** Who's signed in to the supplier portal and the language it speaks (PortalProvider fills it). */
export type PortalValue = {
  me: PortalMe | null;
  setMe: (me: PortalMe | null) => void;
  lang: string;
  setLang: (lang: string) => void;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
  /** Dates and times in the supplier's language and their phone's own time zone. */
  date: (day: string) => string;
  ago: (iso: string | null | undefined) => string;
};

export const PortalContext = createContext<PortalValue | null>(null);

export function usePortal() {
  const v = useContext(PortalContext);
  if (!v) throw new Error('usePortal outside PortalProvider');
  return v;
}
