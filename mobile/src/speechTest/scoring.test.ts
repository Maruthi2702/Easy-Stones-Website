import { describe, expect, it } from 'vitest';
import { addResult, compact, emptyHeard, heardText, normalize, reportText, scoreAttempt, summarize, termResult, wordErrorRate } from './scoring';
import { HINT_PHRASES, SENTENCES } from './script';

describe('speech test scoring', () => {
  it('an empty closing report never erases what was heard', () => {
    let h = addResult(emptyHeard, 'dropped samples', false);
    h = addResult(h, '', true);
    h = addResult(h, undefined, true);
    h = addResult(h, '   ', false);
    expect(heardText(h)).toBe('dropped samples');
  });

  it('a pause starts a new chunk and the earlier chunks stay (the "text gets replaced" bug)', () => {
    let h = emptyHeard;
    h = addResult(h, 'Dropped samples', false);
    h = addResult(h, 'Dropped samples of Calacatta', false); // a live revision replaces only the chunk being spoken
    h = addResult(h, 'Dropped samples of Calacatta', true);  // the pause: that chunk is finished
    h = addResult(h, ' and Statuario', false);                // the next chunk starts again from nothing
    expect(heardText(h)).toBe('Dropped samples of Calacatta and Statuario');
    h = addResult(h, ' and Statuario Opus', true);
    h = addResult(h, ' follow up Friday', true);
    expect(heardText(h)).toBe('Dropped samples of Calacatta and Statuario Opus follow up Friday');
  });

  it('normalizes punctuation and case', () => {
    expect(normalize('Calacatta-Gold, 3 cm!')).toBe('calacatta gold 3 cm');
    expect(compact('Table Top')).toBe('tabletop');
  });

  it('word error rate is 0 for the same words and counts each slip', () => {
    expect(wordErrorRate('log a visit', 'Log a visit.')).toBe(0);
    expect(wordErrorRate('log a visit', 'log visit')).toBeCloseTo(1 / 3);
    expect(wordErrorRate('log a visit', 'lock a visit')).toBeCloseTo(1 / 3);
    expect(wordErrorRate('', '')).toBe(0);
    expect(wordErrorRate('', 'noise')).toBe(1);
  });

  it('a hard word is exact when present, even split or joined differently', () => {
    expect(termResult('tabletop', 'placed a table top today').state).toBe('exact');
    expect(termResult('Calacatta Gold', 'they liked the calacatta gold').state).toBe('exact');
  });

  it('a near miss is close, a different word is missed and shows what was heard', () => {
    expect(termResult('Calacatta', 'the cala cotta was nice').state).toBe('close');
    expect(termResult('Statuario', 'the statuary o looked good').state).toBe('close');
    const missed = termResult('Radianz', 'we put a banana in the lobby');
    expect(missed.state).toBe('missed');
    expect(missed.heardAs).toBeTruthy();
  });

  it('short words are held to one slip', () => {
    expect(termResult('Moda', 'a mode a was placed').state).toBe('close');
    expect(termResult('Moda', 'a banana').state).toBe('missed');
  });

  it('summarizes each setting on its own', () => {
    const a = scoreAttempt({ id: '1', config: 'plain', expected: 'Calacatta Gold', heard: 'cala cotta gold', terms: ['Calacatta Gold'] });
    const b = scoreAttempt({ id: '1', config: 'hints', expected: 'Calacatta Gold', heard: 'Calacatta Gold', terms: ['Calacatta Gold'] });
    const s = summarize([a, b]);
    expect(s.find((x) => x.config === 'plain')).toMatchObject({ sentences: 1, close: 1, exact: 0, missed: 0 });
    expect(s.find((x) => x.config === 'hints')).toMatchObject({ exact: 1, avgWer: 0 });
  });

  it('the report names the slips', () => {
    const a = scoreAttempt({ id: 'stone-1', config: 'plain', expected: 'Taj Mahal quartzite', heard: 'taj mahal quartz site', terms: ['quartzite'] });
    const text = reportText([a], { device: 'iPhone', onDeviceSupported: true, when: 'today' });
    expect(text).toContain('plain: 1 sentences');
    expect(text).toContain('quartzite →');
  });

  it('the script is well formed and the hint list fits Apple\'s limit', () => {
    expect(HINT_PHRASES.length).toBeLessThanOrEqual(100);
    expect(new Set(HINT_PHRASES).size).toBe(HINT_PHRASES.length);
    const ids = SENTENCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SENTENCES) {
      expect(s.terms.length).toBeGreaterThan(0);
      for (const t of s.terms) expect(compact(s.say)).toContain(compact(t));
    }
  });
});
