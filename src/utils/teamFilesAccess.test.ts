import type { Loose } from '../types/records.ts';
import { describe, it, expect } from 'vitest';
import {
  TEAM_FILES_PERMISSIONS as P, ALL_TEAM_FILES_PERMISSIONS, TEAM_FILES_MIGRATION,
  canViewTeamFiles, canManageTeamFiles, withTeamFilesViewRule
} from './teamFilesAccess.ts';

const user = (...permissions): Loose => ({ permissions });

describe('Team Files permissions', () => {
  it('has the two keys the routes, nav and card read', () => {
    expect(P).toEqual({ VIEW: 'view_team_files', MANAGE: 'manage_team_files' });
    expect(ALL_TEAM_FILES_PERMISSIONS).toEqual(['view_team_files', 'manage_team_files']);
  });

  it('View opens the page; Manage needs View too', () => {
    expect(canViewTeamFiles(user(P.VIEW))).toBe(true);
    expect(canManageTeamFiles(user(P.VIEW))).toBe(false);
    expect(canManageTeamFiles(user(P.VIEW, P.MANAGE))).toBe(true);
    expect(canManageTeamFiles(user(P.MANAGE))).toBe(false);
  });

  it('the Dashboard alone no longer opens it, and a customer login never does', () => {
    expect(canViewTeamFiles(user('view_dashboard'))).toBe(false);
    expect(canViewTeamFiles({ permissions: [] })).toBe(false);
    expect(canViewTeamFiles(null)).toBe(false);
    expect(canManageTeamFiles({})).toBe(false);
  });

  it('gives every Dashboard role both switches once', () => {
    expect(TEAM_FILES_MIGRATION).toEqual([{ from: 'view_dashboard', grant: [P.VIEW, P.MANAGE] }]);
  });

  it('keeps the View rule on the card', () => {
    expect(withTeamFilesViewRule([P.VIEW, P.MANAGE], [P.MANAGE])).toEqual([]);
    expect(withTeamFilesViewRule([], [P.MANAGE])).toEqual([P.MANAGE, P.VIEW]);
    expect(withTeamFilesViewRule([P.VIEW], [P.VIEW, P.MANAGE])).toEqual([P.VIEW, P.MANAGE]);
    // A change on another card leaves an old role as it was.
    expect(withTeamFilesViewRule([P.MANAGE], [P.MANAGE, 'view_dashboard'])).toEqual([P.MANAGE, 'view_dashboard']);
  });
});
