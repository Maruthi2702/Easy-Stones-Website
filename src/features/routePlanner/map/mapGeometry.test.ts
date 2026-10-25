import { describe, it, expect } from 'vitest';
import { smoothClosedPath, paddedBounds, insideBounds, VIEW_PAD } from './mapGeometry';

describe('smoothClosedPath', () => {
  const square = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }, { lat: 1, lng: 0 }];
  it('doubles the points on every pass (3 passes by default)', () => {
    expect(smoothClosedPath(square)).toHaveLength(32);
    expect(smoothClosedPath(square, 1)).toHaveLength(8);
  });
  it('cuts each edge at a quarter and three quarters, wrapping round to the start', () => {
    const once = smoothClosedPath(square, 1);
    expect(once[0]).toEqual({ lat: 0, lng: 0.25 });
    expect(once[1]).toEqual({ lat: 0, lng: 0.75 });
    expect(once[7]).toEqual({ lat: 0.25, lng: 0 });
  });
  it('leaves fewer than three points alone', () => {
    const two = [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }];
    expect(smoothClosedPath(two)).toBe(two);
  });
});

describe('paddedBounds / insideBounds', () => {
  const map = (ne: [number, number] | null, sw: [number, number] = [0, 0]) => ({
    getBounds: () => (ne ? { getNorthEast: () => ({ lat: () => ne[0], lng: () => ne[1] }), getSouthWest: () => ({ lat: () => sw[0], lng: () => sw[1] }) } : undefined)
  }) as unknown as google.maps.Map;
  it('is null before the map has bounds', () => {
    expect(paddedBounds(map(null))).toBeNull();
  });
  it('pads the view by VIEW_PAD on every side', () => {
    const b = paddedBounds(map([10, 20]))!;
    expect(b.north).toBeCloseTo(10 + 10 * VIEW_PAD);
    expect(b.south).toBeCloseTo(-10 * VIEW_PAD);
    expect(b.east).toBeCloseTo(20 + 20 * VIEW_PAD);
    expect(b.west).toBeCloseTo(-20 * VIEW_PAD);
  });
  it('tells a point inside from one outside, edges included', () => {
    const b = { north: 1, south: 0, east: 1, west: 0 };
    expect(insideBounds(b, { lat: 0.5, lng: 0.5 })).toBe(true);
    expect(insideBounds(b, { lat: 1, lng: 0 })).toBe(true);
    expect(insideBounds(b, { lat: 1.1, lng: 0.5 })).toBe(false);
  });
});
