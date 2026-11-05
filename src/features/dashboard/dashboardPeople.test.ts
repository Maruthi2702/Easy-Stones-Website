import { describe, it, expect } from 'vitest';
import {
    MY_TEAM, peopleDefault, repsParam, isJustMe, showsWhoLogged, includesPerson,
    peopleSummary, togglePerson, parseStoredPeople
} from './dashboardPeople';

const names: Record<string, string> = { jesus: 'Jesus B.', bart: 'Bart A.' };
const nameOf = (id: string) => names[id];

describe('the People filter value', () => {
    it('opens on just the viewer', () => {
        expect(peopleDefault('me1')).toEqual(['me1']);
        expect(peopleDefault('')).toEqual(MY_TEAM);
    });

    it('sends the picked ids, nothing for My team', () => {
        expect(repsParam([])).toBe('');
        expect(repsParam(['me1'])).toBe('&reps=me1');
        expect(repsParam(['a', 'b'])).toBe('&reps=a%2Cb');
    });

    it('names who is in view', () => {
        expect(peopleSummary([], 'me1', nameOf)).toBe('My team');
        expect(peopleSummary(['me1'], 'me1', nameOf)).toBe('Me');
        expect(peopleSummary(['jesus'], 'me1', nameOf)).toBe('Jesus B.');
        expect(peopleSummary(['ghost'], 'me1', nameOf)).toBe('1 person');
        expect(peopleSummary(['jesus', 'bart'], 'me1', nameOf)).toBe('2 people');
    });

    it('says who logged a row once more than the viewer is in view', () => {
        expect(isJustMe(['me1'], 'me1')).toBe(true);
        expect(showsWhoLogged(['me1'], 'me1')).toBe(false);
        expect(showsWhoLogged([], 'me1')).toBe(true);
        expect(showsWhoLogged(['jesus'], 'me1')).toBe(true);
    });

    it('knows whether a new visit belongs in the list', () => {
        expect(includesPerson([], 'anyone')).toBe(true);
        expect(includesPerson(['me1'], 'me1')).toBe(true);
        expect(includesPerson(['jesus'], 'me1')).toBe(false);
    });

    it('ticks and unticks, falling back to the viewer rather than everyone', () => {
        const team = ['me1', 'jesus', 'bart'];
        expect(togglePerson(['me1'], 'jesus', 'me1', team)).toEqual(['me1', 'jesus']);
        expect(togglePerson(['me1', 'jesus'], 'me1', 'me1', team)).toEqual(['jesus']);
        expect(togglePerson(['jesus'], 'jesus', 'me1', team)).toEqual(['me1']);
    });

    it('unticks one teammate from My team while keeping everyone else selected', () => {
        expect(togglePerson([], 'jesus', 'me1', ['me1', 'jesus', 'bart'])).toEqual(['me1', 'bart']);
    });

    it('keeps the viewer when missing from the options and removes duplicate ids', () => {
        expect(togglePerson([], 'jesus', 'me1', ['jesus', 'bart', 'bart'])).toEqual(['me1', 'bart']);
    });

    it('reads a remembered value back, or nothing', () => {
        expect(parseStoredPeople('["a","b"]')).toEqual(['a', 'b']);
        expect(parseStoredPeople('[]')).toEqual([]);
        expect(parseStoredPeople('{"a":1}')).toBeNull();
        expect(parseStoredPeople('not json')).toBeNull();
        expect(parseStoredPeople(null)).toBeNull();
    });
});
