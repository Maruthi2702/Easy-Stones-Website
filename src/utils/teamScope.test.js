import { describe, it, expect } from 'vitest';
import {
  ALL_PEOPLE, viewerLocations, workLocationsOf, teammatesOf, inTeam,
  visiblePeople, narrowPeople, parseRepsParam, peopleOptions, canSeeTeamCalendar, calendarPeople
} from './teamScope.js';

const staff = [
  { _id: 'jesus', location: 'Seattle', assignedLocations: ['Seattle'] },
  { _id: 'bart', location: 'Kent', assignedLocations: ['Kent'] },
  { _id: 'both', location: 'Kent', assignedLocations: ['Kent', 'Seattle'] },
  { _id: 'gone', location: 'Seattle', assignedLocations: [], isActive: false },
  { _id: 'boss', assignedLocations: ['*'] },
  { _id: 'mgr', location: 'Seattle', assignedLocations: ['Seattle'] }
];
const mgr = { id: 'mgr', permissions: ['view_branch_visits'], assignedLocations: ['Seattle'] };
const ids = (team) => (team === ALL_PEOPLE ? team : [...team].sort());

describe('where people work', () => {
  it("reads the viewer's assigned locations, '*' as everyone", () => {
    expect(viewerLocations(mgr)).toEqual(['Seattle']);
    expect(viewerLocations({ assignedLocations: ['*', 'Kent'] })).toBe(ALL_PEOPLE);
    expect(viewerLocations({})).toEqual([]);
  });

  it("reads a person's location plus assigned locations, without '*'", () => {
    expect(workLocationsOf(staff[2])).toEqual(['Kent', 'Seattle']);
    expect(workLocationsOf(staff[4])).toEqual([]);
  });
});

describe('teammatesOf', () => {
  it("is everyone working at the viewer's locations, deactivated included, plus the viewer", () => {
    expect(ids(teammatesOf(mgr, staff))).toEqual(['both', 'gone', 'jesus', 'mgr']);
  });

  it("leaves out someone assigned '*' and anyone only at other branches", () => {
    const team = teammatesOf(mgr, staff);
    expect(inTeam(team, 'boss')).toBe(false);
    expect(inTeam(team, 'bart')).toBe(false);
  });

  it("is everyone for an all-locations viewer", () => {
    expect(teammatesOf({ id: 'boss', assignedLocations: ['*'] }, staff)).toBe(ALL_PEOPLE);
  });

  it('holds the viewer even with no locations', () => {
    expect(ids(teammatesOf({ id: 'x' }, staff))).toEqual(['x']);
  });
});

describe('visiblePeople', () => {
  it('follows the Visits view permissions', () => {
    expect(visiblePeople({ id: 'a', permissions: ['view_all_visits'] }, staff)).toBe(ALL_PEOPLE);
    expect(ids(visiblePeople(mgr, staff))).toEqual(['both', 'gone', 'jesus', 'mgr']);
    expect(ids(visiblePeople({ id: 'jesus', permissions: [], assignedLocations: ['Seattle'] }, staff))).toEqual(['jesus']);
  });
});

describe('narrowPeople', () => {
  const visible = visiblePeople(mgr, staff);

  it('keeps everyone visible when nothing is picked', () => {
    expect(narrowPeople(visible, {}, staff)).toBe(visible);
    expect(narrowPeople(visible, { reps: [], location: '*' }, staff)).toBe(visible);
  });

  it('narrows to the picked reps and never widens', () => {
    expect(ids(narrowPeople(visible, { reps: ['jesus', 'bart'] }, staff))).toEqual(['jesus']);
    expect(ids(narrowPeople(visible, { reps: ['bart'] }, staff))).toEqual([]);
  });

  it('narrows to people working at the picked location', () => {
    const all = ALL_PEOPLE;
    expect(ids(narrowPeople(all, { location: 'Kent' }, staff))).toEqual(['bart', 'both']);
    expect(ids(narrowPeople(visible, { location: 'Kent' }, staff))).toEqual(['both']);
    expect(ids(narrowPeople(all, { reps: ['jesus'], location: 'Kent' }, staff))).toEqual([]);
  });
});

describe('parseRepsParam', () => {
  it("splits ids and reads 'me' as the viewer", () => {
    expect(parseRepsParam('me, jesus,,', 'mgr')).toEqual(['mgr', 'jesus']);
    expect(parseRepsParam(undefined, 'mgr')).toEqual([]);
  });
});

describe('peopleOptions', () => {
  it('offers the people the viewer can see', () => {
    expect(peopleOptions(mgr, staff).map((p) => p._id).sort()).toEqual(['both', 'gone', 'jesus', 'mgr']);
    expect(peopleOptions({ id: 'jesus', permissions: [] }, staff).map((p) => p._id)).toEqual(['jesus']);
  });
});

describe('calendarPeople', () => {
  it("is the viewer's team with the Team calendar switch, else only themselves", () => {
    const withSwitch = { ...mgr, permissions: ['view_team_calendar'] };
    expect(canSeeTeamCalendar(withSwitch)).toBe(true);
    expect(ids(calendarPeople(withSwitch, staff))).toEqual(['both', 'gone', 'jesus', 'mgr']);
    expect(ids(calendarPeople(mgr, staff))).toEqual(['mgr']);
    expect(calendarPeople({ id: 'boss', permissions: ['view_team_calendar'], assignedLocations: ['*'] }, staff)).toBe(ALL_PEOPLE);
  });

  it('does not come from the visits switches', () => {
    expect(ids(calendarPeople({ id: 'a', permissions: ['view_all_visits'], assignedLocations: ['Seattle'] }, staff))).toEqual(['a']);
  });
});
