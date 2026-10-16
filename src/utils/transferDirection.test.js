import { describe, it, expect } from 'vitest';
import {
  manualTransferDirection, manualTransferWarning, transferWarningText, transferNumberOf, cleanTransferNumber, transferCountOf,
  transferLineKey, mergeTypedTransferSlabs, upgradeHandSetKeys
} from './transferDirection.js';

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
  const ticketA = { fromTo: 'SPO — SEA', direction: 'in', auto: true, transferNumber: '14956' };
  const ticketB = { fromTo: 'SPO — SEA', direction: 'in', auto: true, transferNumber: '149567' };
  const ticketOut = { fromTo: 'SEA — SLC', direction: 'out', auto: true, transferNumber: '19001' };
  const code = (...args) => manualTransferWarning(...args)?.code ?? null;

  it('flags a transfer number already on the report, from a ticket or typed on another line', () => {
    expect(manualTransferWarning({ fromTo: 'SPO — SEA', transferNumber: '149567' }, 'SEA', [ticketA, ticketB]))
      .toEqual({ code: 'number-on-report', numbers: ['149567'] });
    const typed = { fromTo: 'DAL — SEA', transferNumber: '#20010' };
    expect(code({ fromTo: 'DAL — SEA', transferNumber: '20010' }, 'SEA', [typed])).toBe('number-on-report');
  });

  it('a new transfer number on a route a ticket line also covers is fine', () => {
    expect(code({ fromTo: 'SPO — SEA', transferNumber: '18999' }, 'SEA', [ticketA])).toBeNull();
  });

  it('with no number yet, flags a route a ticket line already covers, either way', () => {
    expect(code({ fromTo: 'SPO — SEA' }, 'SEA', [ticketA])).toBe('duplicate');
    expect(code({ fromTo: 'SEA — SLC' }, 'SEA', [ticketOut])).toBe('duplicate');
    expect(code({ fromTo: 'SEA — SPO' }, 'SEA', [ticketA])).toBeNull();
  });

  it('flags a route that doesn\'t include this branch, and the same branch at both ends', () => {
    expect(code({ fromTo: 'SPO — SLC' }, 'SEA')).toBe('not-this-branch');
    expect(code({ fromTo: 'SEA — SEA' }, 'SEA')).toBe('same-branch');
  });

  it('says nothing about an unfinished route, a ticket line, or a fine one', () => {
    expect(code({ fromTo: 'SPO — ' }, 'SEA')).toBeNull();
    expect(code(ticketA, 'SEA', [ticketA])).toBeNull();
    expect(code({ fromTo: 'DAL — SEA' }, 'SEA', [ticketA, ticketOut])).toBeNull();
  });

  it('has words for each warning', () => {
    expect(transferWarningText({ code: 'number-on-report', numbers: ['14956'] })).toMatch(/Transfer #14956 is already on this report/);
    expect(transferWarningText({ code: 'not-this-branch' }, 'Seattle')).toMatch(/doesn't include Seattle/);
    expect(transferWarningText({ code: 'duplicate' })).toMatch(/counted twice/);
    expect(transferWarningText(null)).toBe('');
  });
});

describe('one transfer, one number, one line', () => {
  it('reads the number, and a typed box keeps one number only', () => {
    expect(transferNumberOf({ transferNumber: ' #14956 ' })).toBe('14956');
    expect(transferNumberOf({})).toBe('');
    expect(cleanTransferNumber('14956, 149567')).toBe('14956149567');
    expect(cleanTransferNumber(' 149 567 ')).toBe('149567');
  });

  it('counts a line as one transfer once it has anything on it', () => {
    expect(transferCountOf({ fromTo: 'DAL — SEA', transferNumber: '14956' })).toBe(1);
    expect(transferCountOf({ fromTo: 'DAL — SEA' })).toBe(1);
    expect(transferCountOf({ fromTo: '', slabs: 12 })).toBe(1);
    expect(transferCountOf({ fromTo: '', slabs: null })).toBe(0);
    expect(transferCountOf({ auto: true, transferNumber: '1' })).toBe(1);
  });
});

describe('transferLineKey and carrying typed slabs over', () => {
  const t = (fromTo, transferNumber, slabs, extra = {}) => ({ fromTo, transferNumber, slabs, auto: true, direction: 'out', ...extra });

  it('tells two transfers on one route apart, by number or else ticket id', () => {
    expect(transferLineKey(t('SEA — SLC', '14956'))).toBe('out:SEA — SLC#14956');
    expect(transferLineKey(t('SEA — SLC', '', 0, { ticketIds: ['d1'] }))).toBe('out:SEA — SLC#id:d1');
    // a line from before transfer numbers keeps the old key
    expect(transferLineKey({ fromTo: 'SEA — SLC', direction: 'out' })).toBe('out:SEA — SLC');
  });

  it('keeps each line\'s own typed figure; two tickets on one route never share one', () => {
    const stored = [t('SEA — SLC', '14956', 40)];
    const derived = [t('SEA — SLC', '14956', 12), t('SEA — SLC', '149567', 30)];
    expect(mergeTypedTransferSlabs(stored, derived).map(x => x.slabs)).toEqual([40, 30]);
  });

  it('carries a figure from a draft saved per route when the route has one ticket now', () => {
    const legacy = [{ fromTo: 'SEA — SLC', slabs: 40, auto: true, direction: 'out' }];
    expect(mergeTypedTransferSlabs(legacy, [t('SEA — SLC', '14956', 12)])[0].slabs).toBe(40);
    // two tickets: no telling whose it was, so each shows its tickets' figure
    expect(mergeTypedTransferSlabs(legacy, [t('SEA — SLC', '14956', 12), t('SEA — SLC', '149567', 30)]).map(x => x.slabs)).toEqual([12, 30]);
  });

  it('upgrades a hand-set key in the old form to the one line now on that route', () => {
    const lines = [t('SEA — SLC', '14956', 40), t('SEA — SPO', '1', 1), t('SEA — SPO', '2', 2)];
    expect(upgradeHandSetKeys(['out:SEA — SLC', 'out:SEA — SPO', 'out:SEA — SLC#14956'], lines))
      .toEqual(['out:SEA — SLC#14956', 'out:SEA — SPO', 'out:SEA — SLC#14956']);
  });
});
