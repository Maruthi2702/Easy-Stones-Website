import { describe, expect, it } from 'vitest';
import { nameTokens, normalizeName, phoneticKey, rankBySound } from './soundAlike';
import type { SoundCandidate } from './soundAlike';

const c = (value: string, label: string, city = ''): SoundCandidate => ({ value, label, city });

const LIST: SoundCandidate[] = [
  c('1', 'Smith Granite', 'Kent'),
  c('2', 'Smith Granite', 'Tacoma'),
  c('3', 'Cascade Fabrication', 'Seattle'),
  c('4', 'Cascade Stone Supply', 'Bellevue'),
  c('5', 'Evergreen Kitchens & Baths', 'Everett'),
  c('6', 'Rainier Countertops LLC', 'Renton'),
  c('7', 'Café Tile Co.', 'Auburn'),
  c('8', "O'Brien Marble Works, Inc.", 'Olympia'),
  c('9', 'Calacatta Direct', 'Tukwila'),
  c('10', 'Harbor Stone Works', 'Gig Harbor'),
  c('11', 'Pacific Surfaces', 'Tacoma')
];

const idsOf = (r: { candidates: { option: SoundCandidate }[] }) => r.candidates.map((m) => m.option.value);

describe('normalising names', () => {
  it('ignores case, punctuation, accents and "&"', () => {
    expect(normalizeName("  Café TILE, Co.  ")).toBe('cafe tile co');
    expect(normalizeName('Evergreen Kitchens & Baths')).toBe('evergreen kitchens and baths');
    expect(normalizeName("O'Brien")).toBe('obrien');
  });
  it('drops noise words, but keeps them when nothing else is left', () => {
    expect(nameTokens('Rainier Countertops LLC')).toEqual(['rainier', 'countertops']);
    expect(nameTokens('The Stone Company, Inc.')).toEqual(['stone']);
    expect(nameTokens('The Co')).toEqual(['the', 'co']);
  });
});

describe('phoneticKey', () => {
  it('gives names that sound alike the same key', () => {
    expect(phoneticKey('Granite')).toBe(phoneticKey('grant it'));
    expect(phoneticKey('Smith')).toBe(phoneticKey('Smyth'));
    expect(phoneticKey('Phillips')).toBe(phoneticKey('Fillips'));
    expect(phoneticKey('Calacatta')).toBe(phoneticKey('cala cotta'));
    expect(phoneticKey('Knight')).toBe(phoneticKey('Nite'));
  });
  it('keeps different names apart', () => {
    expect(phoneticKey('Granite')).not.toBe(phoneticKey('Marble'));
    expect(phoneticKey('Cascade')).not.toBe(phoneticKey('Pacific'));
  });
  it('is empty for nothing', () => {
    expect(phoneticKey('')).toBe('');
    expect(phoneticKey('  - ')).toBe('');
  });
});

describe('rankBySound: finding the customer', () => {
  it('takes an exact name that only one customer has', () => {
    const r = rankBySound(LIST, 'Cascade Fabrication');
    expect(r.verdict).toBe('clear');
    expect(idsOf(r)).toEqual(['3']);
  });
  it('is not bothered by capitals, noise words or punctuation', () => {
    expect(idsOf(rankBySound(LIST, 'rainier countertops'))).toEqual(['6']);
    expect(idsOf(rankBySound(LIST, 'The Rainier Countertops, Inc.'))).toEqual(['6']);
    expect(idsOf(rankBySound(LIST, 'evergreen kitchens and baths'))).toEqual(['5']);
    expect(idsOf(rankBySound(LIST, 'Evergreen Kitchens & Baths'))).toEqual(['5']);
  });
  it('handles accents and apostrophes', () => {
    expect(idsOf(rankBySound(LIST, 'cafe tile'))).toEqual(['7']);
    expect(idsOf(rankBySound(LIST, 'obrien marble works'))).toEqual(['8']);
  });
  it('finds a name from its sound: "smith grant it" is Smith Granite', () => {
    const r = rankBySound([c('1', 'Smith Granite', 'Kent'), c('3', 'Cascade Fabrication')], 'smith grant it');
    expect(r.verdict).toBe('clear');
    expect(idsOf(r)).toEqual(['1']);
  });
  it('finds a spelling the recogniser invented', () => {
    expect(idsOf(rankBySound(LIST, 'Rainer Counter Tops'))).toEqual(['6']);
    expect(idsOf(rankBySound(LIST, 'cala cotta direct'))).toEqual(['9']);
    expect(idsOf(rankBySound(LIST, 'Harbour Stone Works'))).toEqual(['10']);
  });
  it('accepts an abbreviation: "Cascade Fab" is Cascade Fabrication, not Cascade Stone Supply', () => {
    const r = rankBySound(LIST, 'Cascade Fab');
    expect(r.verdict).toBe('clear');
    expect(idsOf(r)).toEqual(['3']);
  });
  it('accepts the words in a different order and a plural', () => {
    expect(idsOf(rankBySound(LIST, 'Works Harbor Stone'))).toEqual(['10']);
    expect(idsOf(rankBySound(LIST, 'Evergreen Kitchen'))).toEqual(['5']);
  });
  it('accepts one distinctive word', () => {
    expect(idsOf(rankBySound(LIST, 'Pacific'))).toEqual(['11']);
    expect(idsOf(rankBySound(LIST, 'Rainier'))).toEqual(['6']);
  });
});

describe('rankBySound: when to ask', () => {
  it('is ambiguous for two customers with the same name, listing both', () => {
    const r = rankBySound(LIST, 'Smith Granite');
    expect(r.verdict).toBe('ambiguous');
    expect(idsOf(r).sort()).toEqual(['1', '2']);
    expect(r.candidates.map((m) => m.option.city).sort()).toEqual(['Kent', 'Tacoma']);
  });
  it('a spoken city settles it', () => {
    const r = rankBySound(LIST, 'Smith Granite', 'Kent');
    expect(r.verdict).toBe('clear');
    expect(idsOf(r)).toEqual(['1']);
    expect(r.candidates[0].cityMatch).toBe(true);
    expect(idsOf(rankBySound(LIST, 'Smith Granite', 'tacoma'))).toEqual(['2']);
  });
  it('a city that fits neither leaves it ambiguous', () => {
    expect(rankBySound(LIST, 'Smith Granite', 'Spokane').verdict).toBe('ambiguous');
  });
  it('is ambiguous when one word fits several ("Cascade")', () => {
    const r = rankBySound(LIST, 'Cascade');
    expect(r.verdict).toBe('ambiguous');
    expect(idsOf(r).sort()).toEqual(['3', '4']);
  });
  it('is ambiguous for a near-same pair of names', () => {
    const list = [c('a', 'Northwest Stone', 'Seattle'), c('b', 'North West Stone', 'Spokane'), c('z', 'Zed Tile')];
    const r = rankBySound(list, 'north west stone');
    expect(r.verdict).toBe('ambiguous');
    expect(idsOf(r).sort()).toEqual(['a', 'b']);
  });
  it('does not take an exact name when a longer name merely contains it: the exact one wins', () => {
    const list = [c('a', 'Smith Granite', 'Kent'), c('b', 'Smith Granite & Tile', 'Kent')];
    const r = rankBySound(list, 'Smith Granite');
    expect(r.verdict).toBe('clear');
    expect(idsOf(r)).toEqual(['a']);
  });
  it('caps the cards', () => {
    const many = Array.from({ length: 12 }, (_, i) => c(String(i), 'Smith Granite', `City ${i}`));
    const r = rankBySound(many, 'Smith Granite');
    expect(r.verdict).toBe('ambiguous');
    expect(r.candidates.length).toBe(5);
  });
});

describe('rankBySound: nothing', () => {
  it('is none for an unknown name', () => {
    const r = rankBySound(LIST, 'Zebra Plumbing');
    expect(r.verdict).toBe('none');
    expect(r.matches).toEqual([]);
    expect(r.candidates).toEqual([]);
  });
  it('is none for blank words, an empty list or no list', () => {
    expect(rankBySound(LIST, '').verdict).toBe('none');
    expect(rankBySound(LIST, '   ').verdict).toBe('none');
    expect(rankBySound([], 'Smith Granite').verdict).toBe('none');
    expect(rankBySound(null, 'Smith Granite').verdict).toBe('none');
    expect(rankBySound(undefined, 'Smith').verdict).toBe('none');
  });
  it('shows, rather than takes, a word that fits only a small part of a long name', () => {
    const r = rankBySound(LIST, 'Marble');
    expect(r.verdict).toBe('ambiguous');
    expect(idsOf(r)).toEqual(['8']);
  });
  it('does not match on noise words alone', () => {
    expect(rankBySound(LIST, 'the and inc').verdict).toBe('none');
  });
});

describe('rankBySound: result shape', () => {
  it('returns matches best first, with the original options', () => {
    const r = rankBySound(LIST, 'Cascade');
    expect(r.matches[0].score).toBeGreaterThanOrEqual(r.matches[r.matches.length - 1].score);
    expect(r.matches[0].option).toBe(LIST[2] === r.matches[0].option ? LIST[2] : LIST[3]);
  });
  it('limits the matches', () => {
    const many = Array.from({ length: 20 }, (_, i) => c(String(i), 'Smith Granite', `City ${i}`));
    expect(rankBySound(many, 'Smith Granite', '', 3).matches.length).toBe(3);
  });
  it('is quick on a few thousand customers', () => {
    const big = Array.from({ length: 5000 }, (_, i) => c(String(i), `Customer ${i} Stone Works`, 'Kent'));
    big.push(c('x', 'Cascade Fabrication', 'Seattle'));
    const t = Date.now();
    const r = rankBySound(big, 'cascade fab');
    expect(idsOf(r)).toEqual(['x']);
    expect(Date.now() - t).toBeLessThan(1500);
  });
});
