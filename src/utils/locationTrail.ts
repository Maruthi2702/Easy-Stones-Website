/**
 * Reading a day's trail honestly (location v2, 2026-11-22). A phone that stops reporting leaves a GAP; the
 * map must never draw a straight line across it as if the person drove there. `trailSegments` cuts the
 * trail where two points are further apart in time than `gapMs`, and lists each gap so the screen can say
 * "No data 1:10 – 2:40 PM". The phone also sends a "still here" point every few minutes while it runs, so a
 * quiet stretch longer than the gap really is missing data, not a person sitting still. Pure; tested.
 */
export const GAP_MS = 12 * 60 * 1000;
export type TrailPoint = { lat: number; lng: number; at: Date };
export type TrailGap = { from: Date; to: Date; minutes: number };

export function trailSegments<T extends { at: Date }>(points: T[], gapMs: number = GAP_MS): { segments: T[][]; gaps: TrailGap[] } {
  const segments: T[][] = [];
  const gaps: TrailGap[] = [];
  for (const p of points) {
    const seg = segments[segments.length - 1];
    const prev = seg?.[seg.length - 1];
    if (!seg || !prev) { segments.push([p]); continue; }
    const dt = p.at.getTime() - prev.at.getTime();
    if (dt > gapMs) { gaps.push({ from: prev.at, to: p.at, minutes: Math.round(dt / 60000) }); segments.push([p]); }
    else seg.push(p);
  }
  return { segments, gaps };
}

/** Great-circle distance in metres. */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371008.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
