import { describe, it, expect } from 'vitest';
import { canTakeLead, canReleaseLead } from './projectLeadAccess.ts';

const EDIT = ['view_project_leads', 'edit_project_leads'];
const sam = { id: 'u-sam', name: 'Sam', permissions: EDIT };
const lead = { assignedTo: 'Sam', assignedToId: 'u-sam' };

describe('taking and releasing a lead', () => {
  it('can be taken only with Edit, and only while nobody has it', () => {
    expect(canTakeLead(sam, { assignedTo: '' })).toBe(true);
    expect(canTakeLead(sam, lead)).toBe(false);
    expect(canTakeLead({ ...sam, permissions: ['view_project_leads'] }, { assignedTo: '' })).toBe(false);
  });

  it('is released by the person it is with', () => {
    expect(canReleaseLead(sam, lead)).toBe(true);
    expect(canReleaseLead(sam, { assignedTo: '' })).toBe(false);                                   // nothing to release
    expect(canReleaseLead({ ...sam, permissions: ['view_project_leads'] }, lead)).toBe(false);     // needs Edit too
  });

  it('is not released by a colleague', () => {
    const priya = { id: 'u-priya', name: 'Priya', permissions: [...EDIT, 'edit_own_visits'] };
    expect(canReleaseLead(priya, lead, new Set(['u-priya']))).toBe(false);
  });

  it('is released by their superior: Edit all anywhere, Edit branch only over their own team', () => {
    const all = { id: 'u-dir', name: 'Dana', permissions: [...EDIT, 'edit_all_visits'] };
    const branch = { id: 'u-mgr', name: 'Max', permissions: [...EDIT, 'edit_branch_visits'] };
    expect(canReleaseLead(all, lead, new Set(['u-dir']))).toBe(true);
    expect(canReleaseLead(branch, lead, new Set(['u-mgr', 'u-sam']))).toBe(true);    // Sam is on Max's team
    expect(canReleaseLead(branch, lead, new Set(['u-mgr']))).toBe(false);            // another branch's rep
    expect(canReleaseLead({ ...all, permissions: ['view_project_leads', 'edit_all_visits'] }, lead, '*')).toBe(false);   // a superior still needs Project Leads Edit
  });

  it('falls back to the name for a lead with no assignee id', () => {
    expect(canReleaseLead(sam, { assignedTo: 'Sam' })).toBe(true);
    expect(canReleaseLead({ ...sam, id: 'u-x', name: 'Someone' }, { assignedTo: 'Sam' })).toBe(false);
  });
});
