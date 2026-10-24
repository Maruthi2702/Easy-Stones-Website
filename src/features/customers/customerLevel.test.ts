import { describe, it, expect } from 'vitest';
import { getCustomerLevelLabel, getPriceLevelLabel } from './customerLevel';

describe('customer level label', () => {
  it('names a numeric price level, defaulting to level 1', () => {
    expect(getPriceLevelLabel(3)).toBe('Level 3 (30% Margin)');
    expect(getPriceLevelLabel(undefined)).toBe('Level 1 (10% Margin)');
    expect(getPriceLevelLabel(9)).toBe('Level 1 (10% Margin)');
  });
  it('reads the level text first', () => {
    expect(getCustomerLevelLabel({ level: 'Level 2' })).toBe('Level 2 (20% Margin)');
    expect(getCustomerLevelLabel({ level: 'Tier 7' })).toBe('Tier 7');
    expect(getCustomerLevelLabel({ level: 'Wholesale' })).toBe('Wholesale');
  });
  it('falls back to the price level, and to level 1 with no customer', () => {
    expect(getCustomerLevelLabel({ priceLevel: 4 })).toBe('Level 4 (40% Margin)');
    expect(getCustomerLevelLabel(null)).toBe('Level 1 (10% Margin)');
  });
});
