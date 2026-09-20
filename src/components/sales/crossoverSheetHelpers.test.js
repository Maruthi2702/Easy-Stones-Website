import { describe, it, expect } from 'vitest';
import { flattenColorDocs, buildMatrixData, removeCrossoverLocally, upsertColorDoc } from './crossoverSheetHelpers';

const colorDocs = [
  {
    _id: 'c1',
    easyStonesName: 'Enigma',
    crossovers: [
      { _id: 'x1', distributorName: 'MSI', distributorColorName: 'Alabaster White', matchType: 'Direct Crossover' },
      { _id: 'x2', distributorName: 'Stratus', distributorColorName: 'Magnifico', matchType: 'Direct Crossover' }
    ]
  },
  {
    _id: 'c2',
    easyStonesName: 'Crystal',
    crossovers: [
      { _id: 'x3', distributorName: 'MSI', distributorColorName: 'Sparkling White', matchType: 'Similar' }
    ]
  }
];

describe('flattenColorDocs', () => {
  it('produces one row per distributor mapping, carrying colorId and easyStonesName', () => {
    const flat = flattenColorDocs(colorDocs);
    expect(flat).toHaveLength(3);
    expect(flat[0]).toMatchObject({ colorId: 'c1', easyStonesName: 'Enigma', distributorName: 'MSI' });
    expect(flat[2]).toMatchObject({ colorId: 'c2', easyStonesName: 'Crystal', distributorName: 'MSI' });
  });

  it('returns an empty array for an empty input', () => {
    expect(flattenColorDocs([])).toEqual([]);
  });

  it('tolerates a color doc with no crossovers field', () => {
    expect(flattenColorDocs([{ _id: 'c3', easyStonesName: 'Olympic' }])).toEqual([]);
  });
});

describe('buildMatrixData', () => {
  const flat = flattenColorDocs(colorDocs);

  it('groups entries into one row per color with one cell per distributor', () => {
    const { rows, distributors } = buildMatrixData(flat, ['Enigma', 'Crystal']);
    expect(distributors).toEqual(['MSI', 'Stratus']);
    const enigmaRow = rows.find(r => r.easyStonesName === 'Enigma');
    expect(enigmaRow.cells.get('MSI')).toHaveLength(1);
    expect(enigmaRow.cells.get('Stratus')).toHaveLength(1);
  });

  it('seeds every catalog color as an empty row when matchTypeFilter is All', () => {
    const { rows } = buildMatrixData(flat, ['Enigma', 'Crystal', 'Olympic']);
    const olympicRow = rows.find(r => r.easyStonesName === 'Olympic');
    expect(olympicRow).toBeDefined();
    expect(olympicRow.cells.size).toBe(0);
  });

  it('does not seed empty catalog rows when a match-type filter is active', () => {
    const { rows } = buildMatrixData(flat, ['Enigma', 'Crystal', 'Olympic'], { matchTypeFilter: 'Direct Crossover' });
    expect(rows.find(r => r.easyStonesName === 'Olympic')).toBeUndefined();
  });

  it('only seeds empty catalog rows matching the search query — rows with real entries are the caller\'s job to filter', () => {
    // searchQuery here only gates which *empty* catalog rows get seeded;
    // filtering entries that already have data happens upstream, in
    // whatever produced `filteredEntries` before this function runs.
    const { rows } = buildMatrixData(flat, ['Enigma', 'Crystal', 'Olympic', 'Sonoma'], { searchQuery: 'oly' });
    const names = rows.map(r => r.easyStonesName);
    expect(names).toContain('Olympic');
    expect(names).not.toContain('Sonoma');
    // Enigma/Crystal are still present because they came from `flat`
    // (already-matched entries), not from the empty-row seeding this
    // search query gates.
    expect(names).toContain('Enigma');
  });

  it('sorts catalog colors by their price-sheet order, and non-catalog names alphabetically after', () => {
    const withCustom = [...flat, { easyStonesName: 'Zzz Custom', colorId: 'c9', distributorName: 'MSI', distributorColorName: 'Whatever', _id: 'x9' }];
    const { rows } = buildMatrixData(withCustom, ['Crystal', 'Enigma']);
    expect(rows.map(r => r.easyStonesName)).toEqual(['Crystal', 'Enigma', 'Zzz Custom']);
  });
});

describe('removeCrossoverLocally', () => {
  it('removes just the one crossover from its parent doc', () => {
    const next = removeCrossoverLocally(colorDocs, 'c1', 'x1');
    const enigma = next.find(d => d._id === 'c1');
    expect(enigma.crossovers).toHaveLength(1);
    expect(enigma.crossovers[0]._id).toBe('x2');
  });

  it('drops the parent color document entirely once its last mapping is removed', () => {
    const next = removeCrossoverLocally(colorDocs, 'c2', 'x3');
    expect(next.find(d => d._id === 'c2')).toBeUndefined();
    expect(next).toHaveLength(1);
  });
});

describe('upsertColorDoc', () => {
  it('replaces an existing doc by _id', () => {
    const updated = { _id: 'c2', easyStonesName: 'Crystal', crossovers: [] };
    const next = upsertColorDoc(colorDocs, updated);
    expect(next).toHaveLength(2);
    expect(next.find(d => d._id === 'c2').crossovers).toHaveLength(0);
  });

  it('appends a new doc when its _id is not already present', () => {
    const created = { _id: 'c3', easyStonesName: 'Olympic', crossovers: [] };
    const next = upsertColorDoc(colorDocs, created);
    expect(next).toHaveLength(3);
    expect(next[2]).toBe(created);
  });
});
