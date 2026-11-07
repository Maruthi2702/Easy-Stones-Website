// The supplier portal's languages (src/utils/supplierI18n.ts): every language
// has every key, keeps the same placeholders as English, and every reason
// the screens can store has its words.
import { describe, it, expect } from 'vitest';
import { STRINGS, LANGUAGES, COUNTRIES, t, reasonText, pickLanguage } from './supplierI18n';
import { REJECT_REASONS, RETAKE_REASONS, isTimeZone } from './supplierBlocks';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('the supplier portal’s languages', () => {
  const en = STRINGS.en;
  it.each(LANGUAGES.map((l) => l.code))('%s has every key, with the same placeholders, and nothing left blank', (code) => {
    const table = STRINGS[code as keyof typeof STRINGS];
    expect(Object.keys(table).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(table)) {
      expect(value.trim(), `${code}.${key}`).not.toBe('');
      expect(placeholders(value), `${code}.${key}`).toEqual(placeholders(en[key as keyof typeof en]));
    }
  });
  it('names every reason in every language', () => {
    for (const { code } of LANGUAGES) {
      for (const r of REJECT_REASONS) expect(reasonText(code, 'reject', r)).not.toMatch(/^r_/);
      for (const r of RETAKE_REASONS) expect(reasonText(code, 'retake', r)).not.toMatch(/^p_/);
    }
    expect(reasonText('pt', 'reject', 'cracks')).toBe('Trincas ou fissuras');
    expect(reasonText('pt', 'retake', 'dark')).toBe('Foto escura demais');
  });
  it('fills placeholders and falls back to English', () => {
    expect(t('pt', 'slabsApproved', { a: 56, n: 240 })).toBe('56 de 240 chapas aprovadas');
    expect(t('xx', 'signIn')).toBe('Sign in');
  });
  it('picks the browser’s language when offered', () => {
    expect(pickLanguage(['pt-BR', 'en'])).toBe('pt');
    expect(pickLanguage(['fr-FR'])).toBe('en');
    expect(pickLanguage(undefined)).toBe('en');
  });
  it('starts each country on a language and time zone that exist', () => {
    for (const c of COUNTRIES) {
      expect(LANGUAGES.some((l) => l.code === c.language), c.name).toBe(true);
      expect(isTimeZone(c.timeZone), c.name).toBe(true);
    }
  });
});
