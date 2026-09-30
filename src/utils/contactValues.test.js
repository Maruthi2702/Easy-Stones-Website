import { describe, it, expect } from 'vitest';
import { splitContactValues } from './contactValues.js';

describe('splitContactValues', () => {
  it('splits comma- and semicolon-joined values', () => {
    expect(splitContactValues('info@a.net,karissa@a.net')).toEqual(['info@a.net', 'karissa@a.net']);
    expect(splitContactValues('a@x.com; b@x.com ,c@x.com')).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
  });

  it('leaves a single value whole, including one with a slash', () => {
    expect(splitContactValues('253-380-2431')).toEqual(['253-380-2431']);
    expect(splitContactValues('N/A')).toEqual(['N/A']);
  });

  it('drops blanks and repeats', () => {
    expect(splitContactValues('a@x.com,, a@x.com ,')).toEqual(['a@x.com']);
  });

  it('returns nothing for an empty field', () => {
    expect(splitContactValues('')).toEqual([]);
    expect(splitContactValues(null)).toEqual([]);
    expect(splitContactValues(undefined)).toEqual([]);
  });
});
