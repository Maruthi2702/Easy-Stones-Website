import { describe, it, expect } from 'vitest';
import { peopleMatch, peoplePrefilter } from './dashboardMatch.ts';

describe('peopleMatch', () => {
  it('keeps everyone for ALL_PEOPLE', () => {
    expect(peopleMatch('*', 'visits')).toBeNull();
  });

  it("keeps visits logged by the people, and resources by their uploader", () => {
    expect(peopleMatch(new Set(['a', 'b']), 'visits'))
      .toEqual({ $match: { $expr: { $in: [{ $toString: '$visits.createdBy' }, ['a', 'b']] } } });
    expect(peopleMatch(new Set(['a']), 'resources'))
      .toEqual({ $match: { $expr: { $in: [{ $toString: { $ifNull: ['$resources.uploadedBy', '$resources.createdBy'] } }, ['a']] } } });
  });

  it('keeps nothing for nobody', () => {
    expect(peopleMatch(new Set(), 'visits')).toEqual({ $match: { $expr: { $in: [{ $toString: '$visits.createdBy' }, []] } } });
  });
});

describe('peoplePrefilter', () => {
  it('matches customers with an entry by one of the people, in every stored form', () => {
    const both = (id: unknown) => [id, `oid:${id}`];
    expect(peoplePrefilter(new Set(['a']), 'visits', both))
      .toEqual({ $match: { $or: [{ 'visits.createdBy': { $in: ['a', 'oid:a'] } }] } });
    expect(peoplePrefilter(new Set(['a']), 'resources'))
      .toEqual({ $match: { $or: [{ 'resources.uploadedBy': { $in: ['a'] } }, { 'resources.createdBy': { $in: ['a'] } }] } });
    expect(peoplePrefilter('*', 'visits')).toBeNull();
  });
});
