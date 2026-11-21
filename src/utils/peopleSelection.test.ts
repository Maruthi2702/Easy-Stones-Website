import { describe, it, expect } from 'vitest';
import {
    MY_TEAM, peopleDefault, repsParam, isJustMe, showsWhoLogged, includesPerson,
    peopleSummary, togglePerson, parseStoredPeople, branchesOf, tickBranch, untickBranch, sanitizePeople
} from './peopleSelection';

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

describe('branches inside the People list', () => {
    const options = [
        { value: 'me1', location: 'Atlanta' }, { value: 'cris', location: 'Atlanta' }, { value: 'kev', location: 'Atlanta' },
        { value: 'jer', location: 'Seattle' }, { value: 'sco', location: 'Seattle' }, { value: 'boss', location: '' }
    ];
    const label: Record<string, string> = { me1: 'Krish', cris: 'Cristina', kev: 'Kevin', jer: 'Jeremy', sco: 'Scott', boss: 'Boss' };
    const nameOf = (id: string) => label[id];
    const branches = branchesOf(options);

    it('groups by heading, "Other" for no branch', () => {
        expect(branches).toEqual([
            { name: 'Atlanta', ids: ['me1', 'cris', 'kev'] },
            { name: 'Seattle', ids: ['jer', 'sco'] },
            { name: 'Other', ids: ['boss'] }
        ]);
    });

    it('says a whole branch, two branches, and two names', () => {
        expect(peopleSummary(['me1', 'cris', 'kev'], 'me1', nameOf, branches)).toBe('Atlanta (all 3)');
        expect(peopleSummary(['me1', 'cris', 'kev', 'jer', 'sco'], 'me1', nameOf, branches)).toBe('Atlanta + Seattle · 5 people');
        expect(peopleSummary(['cris', 'jer'], 'x', nameOf, branches)).toBe('Cristina + Jeremy');
        expect(peopleSummary(['cris', 'kev', 'jer'], 'x', nameOf, branches)).toBe('3 people');
        expect(peopleSummary(['cris', 'jer'], 'x', nameOf)).toBe('2 people');
    });

    it('never calls a branch-less group a branch', () => {
        expect(peopleSummary(['boss', 'x'], 'me1', nameOf, [{ name: 'Other', ids: ['boss', 'x'] }])).toBe('2 people');
    });

    it('ticks a branch without leaving My team, and mixes branches', () => {
        expect(tickBranch([], ['jer', 'sco'])).toEqual([]);
        expect(tickBranch(['cris'], ['jer', 'sco'])).toEqual(['cris', 'jer', 'sco']);
        expect(tickBranch(['cris', 'jer'], ['jer', 'sco'])).toEqual(['cris', 'jer', 'sco']);
    });

    it('unticks a branch, expanding My team first, and never ends empty', () => {
        const team = ['me1', 'cris', 'kev', 'jer', 'sco'];
        expect(untickBranch(['cris', 'jer'], ['jer', 'sco'], 'me1', team)).toEqual(['cris']);
        expect(untickBranch([], ['jer', 'sco'], 'me1', team)).toEqual(['me1', 'cris', 'kev']);
        expect(untickBranch(['jer'], ['jer', 'sco'], 'me1', team)).toEqual(['me1']);
    });

    it('drops remembered people the viewer may no longer see', () => {
        expect(sanitizePeople(['cris', 'gone'], options, 'me1')).toEqual(['cris']);
        expect(sanitizePeople(['gone'], options, 'me1')).toEqual(['me1']);
        expect(sanitizePeople(['me1'], options, 'me1')).toEqual(['me1']);
        expect(sanitizePeople([], options, 'me1')).toEqual([]);
        expect(sanitizePeople(['cris'], [], 'me1')).toEqual(['cris']);
    });
});
