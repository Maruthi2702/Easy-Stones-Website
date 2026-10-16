import { describe, it, expect } from 'vitest';
import { manualTransferDirection, manualTransferWarning, transferWarningText, transferNumbersOf, transferCountOf } from './transferDirection.js';

describe('manualTransferDirection', () => {
  it('is incoming when the route ends at this branch', () => {
    expect(manualTransferDirection('SPO — SEA', 'SEA')).toBe('in');
  });

  it('is outgoing when it starts here', () => {
    expect(manualTransferDirection('SEA — SPO', 'SEA')).toBe('out');
  });

  it('stays outgoing until the route says otherwise, as a new line always was', () => {
    expect(manualTransferDirection('', 'SEA')).toBe('out');
    expect(manualTransferDirection('SPO — ', 'SEA')).toBe('out');
    expect(manualTransferDirection(' — SEA', 'SEA')).toBe('in');
    expect(manualTransferDirection('SEA — SEA', 'SEA')).toBe('out');
  });

  it('is outgoing with no branch to judge by (All locations)', () => {
    expect(manualTransferDirection('SPO — SEA', '')).toBe('out');
  });

  it('reads a route without the spaces too', () => {
    expect(manualTransferDirection('SPO—SEA', 'SEA')).toBe('in');
  });
});

describe('manualTransferWarning', () => {
  const ticketIn = { fromTo: 'SPO — SEA', direction: 'in', auto: true, count: 2, transferNumber: '18936, 18940' };
  const ticketOut = { fromTo: 'SEA — SLC', direction: 'out', auto: true, count: 1, transferNumber: '19001' };
  const code = (...args) => manualTransferWarning(...args)?.code ?? null;

  it('flags a transfer number already on the report, from a ticket or typed on another line', () => {
    expect(manualTransferWarning({ fromTo: 'SPO — SEA', transferNumber: '18940' }, 'SEA', [ticketIn]))
      .toEqual({ code: 'number-on-report', numbers: ['18940'] });
    const typed = { fromTo: 'DAL — SEA', transferNumber: '#20010' };
    expect(manualTransferWarning({ fromTo: 'DAL — SEA', transferNumber: '20010' }, 'SEA', [typed]))
      .toEqual({ code: 'number-on-report', numbers: ['20010'] });
    expect(code({ fromTo: 'DAL — SEA', transferNumber: '20010, 20010' }, 'SEA', [])).toBe('number-on-report');
  });

  it('a new transfer number on a route a ticket line also covers is fine', () => {
    expect(code({ fromTo: 'SPO — SEA', transferNumber: '18999' }, 'SEA', [ticketIn])).toBeNull();
  });

  it('with no number yet, flags a route a ticket line already covers, either way', () => {
    expect(code({ fromTo: 'SPO — SEA' }, 'SEA', [ticketIn])).toBe('duplicate');
    expect(code({ fromTo: 'SEA — SLC' }, 'SEA', [ticketOut])).toBe('duplicate');
    expect(code({ fromTo: 'SEA — SPO' }, 'SEA', [ticketIn])).toBeNull();
  });

  it('flags a route that doesn\'t include this branch, and the same branch at both ends', () => {
    expect(code({ fromTo: 'SPO — SLC' }, 'SEA')).toBe('not-this-branch');
    expect(code({ fromTo: 'SEA — SEA' }, 'SEA')).toBe('same-branch');
  });

  it('says nothing about an unfinished route, a ticket line, or a fine one', () => {
    expect(code({ fromTo: 'SPO — ' }, 'SEA')).toBeNull();
    expect(code(ticketIn, 'SEA', [ticketIn])).toBeNull();
    expect(code({ fromTo: 'DAL — SEA' }, 'SEA', [ticketIn, ticketOut])).toBeNull();
  });

  it('has words for each warning', () => {
    expect(transferWarningText({ code: 'number-on-report', numbers: ['18940'] })).toMatch(/Transfer #18940 is already on this report/);
    expect(transferWarningText({ code: 'not-this-branch' }, 'Seattle')).toMatch(/doesn't include Seattle/);
    expect(transferWarningText({ code: 'duplicate' })).toMatch(/counted twice/);
    expect(transferWarningText(null)).toBe('');
  });
});

describe('transfer numbers and the count they make', () => {
  it('reads one or several numbers, however they are separated', () => {
    expect(transferNumbersOf({ transferNumber: '18936' })).toEqual(['18936']);
    expect(transferNumbersOf({ transferNumber: ' #18936, 18940 / 18941 ' })).toEqual(['18936', '18940', '18941']);
    expect(transferNumbersOf({})).toEqual([]);
  });

  it('counts a hand-added line by its numbers, or one when it has a route or slabs but no number', () => {
    expect(transferCountOf({ fromTo: 'DAL — SEA', transferNumber: '1, 2, 3' })).toBe(3);
    expect(transferCountOf({ fromTo: 'DAL — SEA' })).toBe(1);
    expect(transferCountOf({ fromTo: '', slabs: 12 })).toBe(1);
    expect(transferCountOf({ fromTo: '', slabs: null })).toBe(0);
  });

  it('keeps a ticket line\'s own count', () => {
    expect(transferCountOf({ auto: true, count: 4, transferNumber: '1' })).toBe(4);
  });
});
