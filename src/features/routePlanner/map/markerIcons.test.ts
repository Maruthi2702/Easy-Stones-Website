import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildMarkerIcon, leadMarkerIcon, pinLook, stopNumberFontSize, PIN_PATH } from './markerIcons';
import { RECENCY_COLORS, LEAD_PIN_COLOR, OPEN_PIN_COLOR } from '../helpers';
import type { MapPin } from '../types';

const svgOf = (icon: google.maps.Icon | undefined) => decodeURIComponent(String(icon?.url).replace('data:image/svg+xml;charset=UTF-8,', ''));
const g = globalThis as unknown as { window?: { google?: unknown } };

beforeAll(() => {
  // Just enough of google.maps for the icon builders.
  const maps = {
    Size: class { w: number; h: number; constructor(w: number, h: number) { this.w = w; this.h = h; } },
    Point: class { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }
  };
  (globalThis as unknown as { window: unknown }).window = { google: { maps } };
});
afterAll(() => { delete g.window; });

const pin = (o: Partial<MapPin>) => ({ _id: 'p', coordinates: { lat: 0, lng: 0 }, recency: { key: 'due', days: 40, label: '40 days ago' }, ...o }) as MapPin;

describe('stopNumberFontSize', () => {
  it('shrinks as the stop number gets longer', () => {
    expect(stopNumberFontSize(7)).toBe(10);
    expect(stopNumberFontSize(12)).toBe(8);
    expect(stopNumberFontSize(120)).toBe(5.5);
  });
});

describe('pinLook', () => {
  it('wears the customer type colour in type mode, grey for none', () => {
    expect(pinLook(RECENCY_COLORS.dark, 'type', pin({ customerType: 'Fabricator' }))).toEqual({ color: '#7B3FBF', ink: '#ffffff' });
    expect(pinLook(RECENCY_COLORS.dark, 'type', pin({ customerType: '' })).color).toBe('#9A9A95');
  });
  it('wears the visit-age colour in visit mode, dark ink on the bright ones', () => {
    expect(pinLook(RECENCY_COLORS.light, 'visit', pin({}))).toEqual({ color: RECENCY_COLORS.light.due, ink: '#141414' });
    expect(pinLook(RECENCY_COLORS.dark, 'visit', pin({ recency: { key: 'never', days: null, label: 'Never visited' } })).ink).toBe('#ffffff');
  });
});

describe('buildMarkerIcon', () => {
  const look = { color: '#123456', ink: '#ffffff' };
  it('a plain pin: 24px, its fill, anchored at the tip', () => {
    const icon = buildMarkerIcon(look, undefined, false) as unknown as { scaledSize: { w: number }; anchor: { x: number; y: number } };
    expect(icon.scaledSize.w).toBe(24);
    expect(icon.anchor).toEqual({ x: 12, y: 22 });
    expect(svgOf(icon as unknown as google.maps.Icon)).toContain('fill="#123456"');
  });
  it('a route stop: 44px with its number in the image', () => {
    const icon = buildMarkerIcon(look, 3, false);
    expect((icon.scaledSize as unknown as { w: number }).w).toBe(44);
    expect(svgOf(icon)).toContain('>3</text>');
  });
  it('the open customer: coral with a ring, whatever its stop number', () => {
    const svg = svgOf(buildMarkerIcon(look, 3, true));
    expect(svg).toContain(`fill="${OPEN_PIN_COLOR}"`);
    expect(svg).not.toContain('</text>');
    expect(svg).toContain(PIN_PATH);
  });
  it('a lead: the fixed lead colour', () => {
    expect(svgOf(leadMarkerIcon())).toContain(`fill="${LEAD_PIN_COLOR}"`);
  });
});
