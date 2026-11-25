import { describe, expect, it } from 'vitest';
import { daysBetween, lineStage, pacificDay, shortDay, type StageExpense } from './statementStage.ts';

const today = '2026-11-24';
const line = { date: '2026-11-21' };
const base: StageExpense = {
  day: '2026-11-20', status: 'waiting', cents: 6418, holderRole: 'sales_rep', holderName: 'Maria Ruiz',
  approval: null, secondApproval: null, ask: null, sentBackAt: null
};
const ok = (byName: string, at: string) => ({ byName, at });

describe('lineStage — lines with no receipt', () => {
  it('a charge waiting for its receipt says how long it has waited', () => {
    expect(lineStage('missing', line, null, today)).toEqual({ tone: 'miss', label: 'No receipt · 3 days', detail: '' });
    expect(lineStage('missing', { date: '2026-11-23' }, null, today).label).toBe('No receipt · 1 day');
    expect(lineStage('missing', { date: today }, null, today).label).toBe('No receipt · today');
  });
  it('the other kinds say what they are', () => {
    expect(lineStage('awaiting', line, null, today)).toMatchObject({ tone: 'wait', label: 'Waiting for Accounting', detail: 'Admin charge · no upload' });
    expect(lineStage('no_card', line, null, today)).toMatchObject({ tone: 'back', label: 'Card not set up' });
    expect(lineStage('unassigned', line, null, today)).toMatchObject({ tone: 'back', label: 'Waiting for a login' });
    expect(lineStage('no_receipt', line, null, today)).toEqual({ tone: 'none', label: 'No receipt needed', detail: '' });
    expect(lineStage('refunded', line, null, today).tone).toBe('none');
    expect(lineStage('before_start', line, null, today).tone).toBe('none');
  });
});

describe('lineStage — a matched line shows where its receipt is in its approvals', () => {
  it('under $150 it waits for Accounting only, naming the receipt', () => {
    expect(lineStage('matched', line, base, today)).toEqual({ tone: 'wait', label: 'Waiting for Accounting', detail: 'Receipt of 11-20' });
  });
  it('$150 or more from staff needs Accounting and a Manager or Admin', () => {
    const big = { ...base, cents: 48_620 };
    expect(lineStage('matched', line, big, today)).toMatchObject({ label: 'Waiting for Accounting, Manager or Admin', detail: '$150+ · needs both' });
    expect(lineStage('matched', line, { ...big, approval: ok('Ana', '2026-11-22T18:00:00Z') }, today))
      .toMatchObject({ label: 'Waiting for Manager or Admin', detail: 'Accounting ✓ Ana' });
    expect(lineStage('matched', line, { ...big, secondApproval: ok('Jeremy', '2026-11-22T18:00:00Z') }, today))
      .toMatchObject({ label: 'Waiting for Accounting', detail: 'Manager or Admin ✓ Jeremy' });
  });
  it("a manager's $150+ receipt needs an Admin as the second; an Admin's own needs Accounting only", () => {
    expect(lineStage('matched', line, { ...base, cents: 64_275, holderRole: 'manager' }, today).label).toBe('Waiting for Accounting, Admin');
    expect(lineStage('matched', line, { ...base, cents: 64_275, holderRole: 'admin' }, today).label).toBe('Waiting for Accounting');
  });
  it('an open question names who was asked', () => {
    expect(lineStage('matched', line, { ...base, ask: { toName: 'Jeremy Cole', answeredAt: null } }, today))
      .toMatchObject({ label: 'Asked Jeremy Cole', detail: 'Waiting for an answer' });
  });
  it('approved names the last approver; sent back names the cardholder; a draft is theirs to finish', () => {
    expect(lineStage('matched', line, { ...base, status: 'approved', cents: 48_620, approval: ok('Ana', '2026-11-22T18:00:00Z'), secondApproval: ok('Jeremy', '2026-11-23T18:00:00Z') }, today))
      .toEqual({ tone: 'ok', label: 'Approved', detail: 'Jeremy · 11-23' });
    expect(lineStage('matched', line, { ...base, status: 'sent_back', sentBackAt: '2026-11-23T20:00:00Z' }, today))
      .toEqual({ tone: 'back', label: 'Sent back', detail: 'To Maria · 11-23' });
    expect(lineStage('matched', line, { ...base, status: 'draft' }, today)).toMatchObject({ tone: 'wait', label: 'Draft', detail: 'Maria is finishing it' });
  });
});

describe('the day helpers', () => {
  it('reads a moment on the Pacific clock and shortens a day', () => {
    expect(pacificDay('2026-11-23T05:00:00Z')).toBe('2026-11-22');
    expect(pacificDay('2026-11-23')).toBe('2026-11-23');
    expect(pacificDay(null)).toBe('');
    expect(shortDay('2026-11-23')).toBe('11-23');
    expect(daysBetween('2026-11-21', '2026-11-24')).toBe(3);
    expect(daysBetween('2026-11-25', '2026-11-24')).toBe(0);
  });
});
