import { describe, it, expect } from 'vitest';
import { groupContainers, groupSlabs } from './dailyReportContainers';

describe('groupContainers', () => {
  it('puts each PO in its own group', () => {
    const groups = groupContainers([
      { poNumber: '111', material: 'Carrara', slabs: 40 },
      { poNumber: '222', material: 'Cristallo', slabs: 16 }
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].poNumber).toBe('111');
    expect(groups[1].poNumber).toBe('222');
  });

  it('folds a blank PO# into the container above it', () => {
    const groups = groupContainers([
      { poNumber: '111', material: 'Carrara Prima MQ', slabs: 40 },
      { poNumber: '', material: 'Carrara Prima Select', slabs: 12 },
      { poNumber: '222', material: 'Cristallo', slabs: 16 },
      { poNumber: '', material: 'Taj Mahal', slabs: 7 },
      { poNumber: '', material: 'Mont Blanc', slabs: 21 }
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].lines).toHaveLength(2);
    expect(groups[1].lines).toHaveLength(3);
  });

  it('treats a leading blank PO# as its own group, since there is no line above it', () => {
    const groups = groupContainers([
      { poNumber: '', material: 'Unlabeled', slabs: 5 }
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].lines).toHaveLength(1);
  });

  it('returns nothing for an empty or missing list', () => {
    expect(groupContainers([])).toEqual([]);
    expect(groupContainers(undefined)).toEqual([]);
  });
});

describe('groupSlabs', () => {
  it('sums slabs across every line in the group', () => {
    const [group] = groupContainers([
      { poNumber: '222', material: 'Cristallo', slabs: 16 },
      { poNumber: '', material: 'Taj Mahal', slabs: 7 },
      { poNumber: '', material: 'Mont Blanc', slabs: 21 }
    ]);
    expect(groupSlabs(group)).toBe(44);
  });

  it('ignores non-numeric slab values', () => {
    const [group] = groupContainers([
      { poNumber: '111', material: 'Carrara', slabs: null },
      { poNumber: '', material: 'Cristallo', slabs: '' }
    ]);
    expect(groupSlabs(group)).toBe(0);
  });
});
