import { describe, it, expect } from 'vitest';
import {
  parseReading, readingProblem, distanceMeters, loggedFromFor, markLabel, milesText, isInPersonType, deviceKind,
  MAX_READING_AGE_MS
} from './visitLocation.ts';

const now = 1_700_000_000_000;
const at = { lat: 47.6062, lng: -122.3321 };
const reading = (over = {}) => ({ ...at, accuracyM: 20, takenAtMs: now, device: 'phone' as const, ...over });
const pin = at;

describe('parseReading', () => {
  it('accepts a real reading', () => expect(parseReading({ ...at, accuracyM: 20.4, takenAtMs: now, device: 'phone' })).toMatchObject({ accuracyM: 20, device: 'phone' }));
  it('refuses missing, out-of-range and 0,0 points', () => {
    expect(parseReading(null)).toBeNull();
    expect(parseReading({ lat: 95, lng: 0, accuracyM: 5, takenAtMs: now })).toBeNull();
    expect(parseReading({ lat: 0, lng: 0, accuracyM: 5, takenAtMs: now })).toBeNull();
    expect(parseReading({ ...at, accuracyM: -1, takenAtMs: now })).toBeNull();
    expect(parseReading({ ...at, accuracyM: '5', takenAtMs: now })).toBeNull();
  });
  it('treats an unknown device as a computer', () => expect(parseReading({ ...at, accuracyM: 5, takenAtMs: now, device: 'x' })?.device).toBe('computer'));
});

describe('readingProblem', () => {
  it('passes a fresh one and refuses an old or future one', () => {
    expect(readingProblem(reading(), now)).toBe('');
    expect(readingProblem(reading({ takenAtMs: now - MAX_READING_AGE_MS - 1 }), now)).toMatch(/out of date/);
    expect(readingProblem(reading({ takenAtMs: now + 10 * 60 * 1000 }), now)).toMatch(/clock/);
  });
});

describe('distance and marks', () => {
  it('is about 111 km for a degree of latitude', () => expect(distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeGreaterThan(110000));
  const meetingAt = (dLat: number, over = {}) => loggedFromFor(reading({ lat: at.lat + dLat, ...over }), { purpose: 'Scheduled in Person Sales Meeting', pin, readAt: 'x' });
  it('On site within 0.25 mi', () => expect(meetingAt(0.001)).toMatchObject({ mark: 'onSite', approximate: false }));
  it('Nearby up to 1 mi, then away', () => {
    expect(meetingAt(0.006).mark).toBe('nearby');
    expect(meetingAt(0.2)).toMatchObject({ mark: 'away' });
  });
  it('a rough reading is never On site', () => {
    expect(meetingAt(0.001, { accuracyM: 900 }).mark).toBe('nearby');
    expect(meetingAt(0.001, { accuracyM: 300 })).toMatchObject({ mark: 'onSite', approximate: true });
  });
  it('remote and admin types keep the reading without a verdict', () => {
    expect(loggedFromFor(reading(), { purpose: 'Important Remote Meeting/Call', pin, readAt: 'x' })).toMatchObject({ mark: 'recorded', distanceM: null });
    expect(loggedFromFor(reading(), { purpose: 'Quick Note', pin, readAt: 'x' }).mark).toBe('recorded');
  });
  it('a customer with no pin is "noPin"', () => {
    expect(loggedFromFor(reading(), { purpose: 'Formal Presentation', pin: { lat: null, lng: null }, readAt: 'x' }).mark).toBe('noPin');
    expect(loggedFromFor(reading(), { purpose: 'Formal Presentation', pin: undefined, readAt: 'x' }).mark).toBe('noPin');
  });
  it('a resource placement counts as in person', () => {
    expect(isInPersonType('Resource Placement: Moda Tower 2024 version 2')).toBe(true);
    expect(isInPersonType('Personal Time Off')).toBe(false);
  });
});

describe('words', () => {
  it('labels', () => {
    expect(markLabel({ mark: 'onSite', distanceM: 100, approximate: false })).toBe('On site');
    expect(markLabel({ mark: 'nearby', distanceM: 965, approximate: true })).toBe('Nearby · 0.6 mi · approx.');
    expect(markLabel({ mark: 'away', distanceM: 29000, approximate: false })).toBe('18 mi away');
    expect(markLabel({ mark: 'recorded', distanceM: null, approximate: false })).toBe('Location recorded');
    expect(milesText(160)).toBe('0.1 mi');
  });
  it('device', () => {
    expect(deviceKind('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('phone');
    expect(deviceKind('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('computer');
    expect(deviceKind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('phone');
    expect(deviceKind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe('computer');
  });
});
