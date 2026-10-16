import { describe, it, expect } from 'vitest';
import { manualTransferDirection, manualTransferWarning, transferWarningText } from './transferDirection.js';

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
  const ticketIn = { fromTo: 'SPO — SEA', direction: 'in', auto: true, count: 1 };
  const ticketOut = { fromTo: 'SEA — SLC', direction: 'out', auto: true, count: 2 };

  it('flags a route that doesn\'t include this branch', () => {
    expect(manualTransferWarning({ fromTo: 'SPO — SLC' }, 'SEA')).toBe('not-this-branch');
  });

  it('flags From and To being the same branch', () => {
    expect(manualTransferWarning({ fromTo: 'SEA — SEA' }, 'SEA')).toBe('same-branch');
  });

  it('flags a hand-added line a ticket line already covers, either way', () => {
    expect(manualTransferWarning({ fromTo: 'SPO — SEA' }, 'SEA', [ticketIn])).toBe('duplicate');
    expect(manualTransferWarning({ fromTo: 'SEA — SLC' }, 'SEA', [ticketOut])).toBe('duplicate');
  });

  it('doesn\'t flag the other direction on the same pair of branches', () => {
    expect(manualTransferWarning({ fromTo: 'SEA — SPO' }, 'SEA', [ticketIn])).toBeNull();
  });

  it('says nothing about an unfinished route, a ticket line, or a fine one', () => {
    expect(manualTransferWarning({ fromTo: 'SPO — ' }, 'SEA')).toBeNull();
    expect(manualTransferWarning(ticketIn, 'SEA', [ticketIn])).toBeNull();
    expect(manualTransferWarning({ fromTo: 'DAL — SEA' }, 'SEA', [ticketIn, ticketOut])).toBeNull();
  });

  it('has words for each warning', () => {
    expect(transferWarningText('not-this-branch', 'Seattle')).toMatch(/doesn't include Seattle/);
    expect(transferWarningText('duplicate')).toMatch(/counted twice/);
    expect(transferWarningText(null)).toBe('');
  });
});
