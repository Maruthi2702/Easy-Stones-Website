import { describe, it, expect } from 'vitest';
import { SLAB_STATUS_BUCKET } from './inventoryStatus.js';

describe('SLAB_STATUS_BUCKET', () => {
  // The six values actually present in the imported SPS stock export, as of
  // the 2026-09-10 snapshot (10,520 slab rows). Each one must land in a named
  // bucket — "Packinglist" and "Pick Ticket" used to fall through to "other",
  // which hid the two states the truck-loading workflow cares about most.
  it.each([
    ['', 'available'],
    ['ONHOLD', 'hold'],
    ['ONSO', 'so'],
    ['ONTRANSFER', 'transfer'],
    ['Packinglist', 'packinglist'],
    ['Pick Ticket', 'pickticket']
  ])('buckets the live SPS value %o as %o', (raw, expected) => {
    expect(SLAB_STATUS_BUCKET(raw)).toBe(expected);
  });

  // SPS is inconsistent about casing and separators between its own values
  // ("ONHOLD" vs "Packinglist" vs "Pick Ticket"), so matching is normalized
  // rather than exact — a future export changing the shape of a value it
  // already exports shouldn't silently demote it to "other".
  it.each([
    ['PACKINGLIST', 'packinglist'],
    ['packinglist', 'packinglist'],
    ['Packing List', 'packinglist'],
    ['PICKTICKET', 'pickticket'],
    ['pick ticket', 'pickticket'],
    ['Pick-Ticket', 'pickticket'],
    ['OnHold', 'hold'],
    ['ON TRANSFER', 'transfer']
  ])('normalizes %o to %o', (raw, expected) => {
    expect(SLAB_STATUS_BUCKET(raw)).toBe(expected);
  });

  it('treats every empty-ish value as available, since SPS leaves the column blank for unencumbered slabs', () => {
    expect(SLAB_STATUS_BUCKET('')).toBe('available');
    expect(SLAB_STATUS_BUCKET(null)).toBe('available');
    expect(SLAB_STATUS_BUCKET(undefined)).toBe('available');
  });

  it('falls back to other for a status SPS has not exported before', () => {
    expect(SLAB_STATUS_BUCKET('ONCONSIGNMENT')).toBe('other');
    expect(SLAB_STATUS_BUCKET('Quarantine')).toBe('other');
  });
});
