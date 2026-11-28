import { describe, it, expect } from 'vitest';
import { cleanVoiceWordInput, glossaryFrom, glossaryText, hintsFrom, monthOf, turnCostUsd, wordsVersion } from './voiceWords.ts';
import { STARTING_VOICE_WORDS } from './voiceWordsSeed.ts';
import { VOICE_WORD_KINDS } from '../db/schema/voiceAssistant.ts';
import { HINTS_MAX } from './assistantContract.ts';
import { VOICE_WORD_KIND_LIST } from './voiceWords.ts';

const w = (heard: string, meant: string, active = true) => ({ heard, meant, active });

describe('cleanVoiceWordInput', () => {
  it('tidies a good word and defaults the kind', () => {
    expect(cleanVoiceWordInput({ heard: '  cala   cotta ', meant: 'Calacatta' })).toEqual({ ok: true, value: { heard: 'cala cotta', meant: 'Calacatta', kind: 'other' } });
  });
  it('needs what it should be', () => {
    expect(cleanVoiceWordInput({ heard: 'x' }).ok).toBe(false);
    expect(cleanVoiceWordInput({ meant: '   ' }).ok).toBe(false);
  });
  it('refuses unknown kinds, long text, a non-boolean active and a word that "hears" itself', () => {
    expect(cleanVoiceWordInput({ meant: 'x', kind: 'weird' }).ok).toBe(false);
    expect(cleanVoiceWordInput({ meant: 'x'.repeat(81) }).ok).toBe(false);
    expect(cleanVoiceWordInput({ meant: 'x', note: 'n'.repeat(301) }).ok).toBe(false);
    expect(cleanVoiceWordInput({ meant: 'x', active: 'no' }).ok).toBe(false);
    expect(cleanVoiceWordInput({ heard: 'Moda', meant: 'moda' }).ok).toBe(false);
  });
  it('a patch checks only what was sent, and is not empty', () => {
    expect(cleanVoiceWordInput({ active: false }, { partial: true })).toEqual({ ok: true, value: { active: false } });
    expect(cleanVoiceWordInput({}, { partial: true }).ok).toBe(false);
    expect(cleanVoiceWordInput({ meant: '' }, { partial: true }).ok).toBe(false);
    expect(cleanVoiceWordInput(null).ok).toBe(false);
  });
  it('knows the same kinds as the table', () => expect([...VOICE_WORD_KIND_LIST]).toEqual([...VOICE_WORD_KINDS]));
});

describe('hintsFrom', () => {
  it('puts words with a known mis-hearing first, then keeps the list\'s order', () => {
    expect(hintsFrom([w('', 'Kent'), w('cala cotta', 'Calacatta'), w('', 'Honed'), w('mode a', 'Moda')])).toEqual(['Calacatta', 'Moda', 'Kent', 'Honed']);
  });
  it('lists a phrase once however many ways it is misheard, and leaves out hidden words', () => {
    expect(hintsFrom([w('a', 'Calacatta'), w('b', 'calacatta'), w('', 'Hidden', false)])).toEqual(['Calacatta']);
  });
  it('stops at the recognizer\'s limit', () => {
    const many = Array.from({ length: 250 }, (_, i) => w('', `Word ${i}`));
    expect(hintsFrom(many)).toHaveLength(HINTS_MAX);
    expect(hintsFrom(many, 5)).toHaveLength(5);
  });
});

describe('the glossary', () => {
  it('is the same text however the words are ordered, so the prompt\'s start can be cached', () => {
    const a = glossaryText(glossaryFrom([w('b heard', 'B'), w('a heard', 'A'), w('', 'Plain')]));
    const b = glossaryText(glossaryFrom([w('', 'Plain'), w('a heard', 'A'), w('b heard', 'B')]));
    expect(a).toBe(b);
    expect(a).toContain('"a heard" → A');
    expect(a.indexOf('"a heard"')).toBeLessThan(a.indexOf('"b heard"'));
    expect(a).toContain('A; B; Plain');
  });
  it('is empty with no words, and skips hidden ones', () => {
    expect(glossaryText(glossaryFrom([]))).toBe('');
    expect(glossaryText(glossaryFrom([w('x', 'Hidden', false)]))).toBe('');
  });
});

describe('wordsVersion', () => {
  it('changes when an active word changes and not when only the order or a hidden word does', () => {
    const base = [w('a', 'A'), w('', 'B')];
    const v = wordsVersion(base);
    expect(wordsVersion([...base].reverse())).toBe(v);
    expect(wordsVersion([...base, w('z', 'Hidden', false)])).toBe(v);
    expect(wordsVersion([...base, w('', 'C')])).not.toBe(v);
    expect(wordsVersion([w('a', 'A2'), w('', 'B')])).not.toBe(v);
    expect(wordsVersion([w('a', 'A')])).not.toBe(v);
    expect(wordsVersion([])).toMatch(/^0-/);
  });
});

describe('what a turn costs', () => {
  it('uses Haiku\'s list price: $0.10 in, $0.50 out per million, cached reads a tenth', () => {
    expect(turnCostUsd({ input: 1_000_000 })).toBeCloseTo(0.1, 8);
    expect(turnCostUsd({ output: 1_000_000 })).toBeCloseTo(0.5, 8);
    expect(turnCostUsd({ cacheRead: 1_000_000 })).toBeCloseTo(0.01, 8);
    expect(turnCostUsd({})).toBe(0);
  });
  it('a typical turn is a fraction of a cent', () => expect(turnCostUsd({ input: 600, output: 120, cacheRead: 1500 })).toBeLessThan(0.0005));
});

describe('monthOf', () => {
  it('accepts YYYY-MM only', () => {
    expect(monthOf('2026-11')).toBe('2026-11');
    for (const bad of ['2026-13', '2026-1', 'Nov', '', undefined, 5]) expect(monthOf(bad)).toBeNull();
  });
});

describe('the starting list', () => {
  it('has a real kind and a meaning for every word, and no word twice', () => {
    const keys = new Set<string>();
    for (const x of STARTING_VOICE_WORDS) {
      expect(VOICE_WORD_KIND_LIST).toContain(x.kind);
      expect(x.meant).toBeTruthy();
      const key = x.heard ? `h:${x.heard.toLowerCase()}` : `p:${x.meant.toLowerCase()}`;
      expect(keys.has(key)).toBe(false);
      keys.add(key);
    }
  });
  it('leads with the words a phone mishears, never offers the hidden Demo location, and fills the recognizer\'s 100', () => {
    expect(STARTING_VOICE_WORDS[0]).toMatchObject({ heard: 'cala cotta', meant: 'Calacatta' });
    expect(STARTING_VOICE_WORDS.some((x) => /demo/i.test(x.meant))).toBe(false);
    expect(hintsFrom(STARTING_VOICE_WORDS)).toHaveLength(HINTS_MAX);
  });
});
