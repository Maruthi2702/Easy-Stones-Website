import { describe, it, expect } from 'vitest';
import { groupBySection, fullAccessOn, listedActions, setAllIn } from './permissionGroups';
import type { PermissionAction } from '../types';

const a = (key: string, section?: string, impliedBy?: string): PermissionAction => ({ key, label: key, desc: '', section, impliedBy });
const card = [a('full', 'Everything'), a('u1', 'Users', 'full'), a('u2', 'Users', 'full'), a('r1', 'Roles', 'full'), a('team', 'Team')];

describe('the page-card dialog', () => {
  it('groups switches by section, in order', () => {
    expect(groupBySection(card).map((g) => [g.section, g.actions.map((x) => x.key)])).toEqual([
      ['Everything', ['full']], ['Users', ['u1', 'u2']], ['Roles', ['r1']], ['Team', ['team']]
    ]);
    expect(groupBySection([a('x'), a('y')])).toEqual([{ section: undefined, actions: [a('x'), a('y')] }]);
  });
  it('hides the switches Full access holds while it is on', () => {
    const users = groupBySection(card)[1];
    expect(fullAccessOn(card, ['full'])).toBe(true);
    expect(fullAccessOn(card, ['u1'])).toBe(false);
    expect(listedActions(users, true)).toEqual([]);
    expect(listedActions(users, false).map((x) => x.key)).toEqual(['u1', 'u2']);
  });
  it('turns a section all on or all off, leaving the rest', () => {
    const listed = [a('u1'), a('u2')];
    expect(setAllIn(['view', 'u1'], listed, true)).toEqual(['view', 'u1', 'u2']);
    expect(setAllIn(['view', 'u1', 'u2'], listed, false)).toEqual(['view']);
  });
});
