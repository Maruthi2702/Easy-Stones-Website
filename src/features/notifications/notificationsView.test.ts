import { describe, expect, it } from 'vitest';
import { groupByBranch, groupState, matchPeople, tickedLine, toggleGroup } from './notificationsView';

const P = (id: string, name: string, branch: string, phones: number, role = 'sales_rep') => ({ id, name, role, branch, phones });
const people = [P('1', 'Zed', 'Seattle', 1), P('2', 'Amy', 'Seattle', 0), P('3', 'Bob', 'Atlanta', 2, 'driver')];

describe('send notification view rules', () => {
  it('searches name, role and branch, A–Z', () => {
    expect(matchPeople(people, '').map(p => p.name)).toEqual(['Amy', 'Bob', 'Zed']);
    expect(matchPeople(people, 'atlanta').map(p => p.name)).toEqual(['Bob']);
    expect(matchPeople(people, 'sales rep').map(p => p.name)).toEqual(['Amy', 'Zed']);
  });
  it('groups by branch A–Z', () => {
    expect(groupByBranch(people).map(g => [g.branch, g.people.length])).toEqual([['Atlanta', 1], ['Seattle', 2]]);
  });
  it('ticks a group only for people with a phone, and unticks everyone', () => {
    const seattle = people.slice(0, 2);
    const on = toggleGroup(new Set(), seattle, true);
    expect([...on]).toEqual(['1']);
    expect(groupState(on, seattle)).toBe('all');
    expect(groupState(new Set(), seattle)).toBe('none');
    expect(groupState(new Set(['1']), people)).toBe('some');
    expect([...toggleGroup(on, seattle, false)]).toEqual([]);
  });
  it('words the count', () => {
    expect(tickedLine(0)).toBe('Nobody ticked');
    expect(tickedLine(1)).toBe('1 person ticked');
    expect(tickedLine(3)).toBe('3 people ticked');
  });
});
