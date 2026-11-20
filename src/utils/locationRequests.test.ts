import { describe, expect, it } from 'vitest';
import { ANSWER_MAX_ACCURACY_M, REQUEST_TTL_MS, canLocateOnRequest, cleanAnswer, cleanReason, requestStatus, requestLine, askedNotice, LOCATE } from './locationRequests.ts';

const t = (iso: string) => new Date(iso);

describe('who may ask', () => {
  it('needs the switch', () => {
    expect(canLocateOnRequest({ permissions: [LOCATE.ASK] })).toBe(true);
    expect(canLocateOnRequest({ permissions: ['view_team_locations'] })).toBe(false);
    expect(canLocateOnRequest(null)).toBe(false);
  });
});

describe('request status', () => {
  const asked = t('2026-11-20T03:00:00Z');
  it('is pending for 15 minutes, then expired, unless answered', () => {
    expect(requestStatus({ requestedAt: asked, answeredAt: null }, new Date(asked.getTime() + 60_000))).toBe('pending');
    expect(requestStatus({ requestedAt: asked, answeredAt: null }, new Date(asked.getTime() + REQUEST_TTL_MS))).toBe('pending');
    expect(requestStatus({ requestedAt: asked, answeredAt: null }, new Date(asked.getTime() + REQUEST_TTL_MS + 1))).toBe('expired');
    expect(requestStatus({ requestedAt: asked, answeredAt: asked }, new Date(asked.getTime() + 10 * REQUEST_TTL_MS))).toBe('answered');
  });
});

describe('the reason', () => {
  it('is required and tidied', () => {
    expect(cleanReason('  Truck   not back  ')).toEqual({ reason: 'Truck not back', problem: '' });
    expect(cleanReason('no').problem).toMatch(/at least 5/);
    expect(cleanReason(undefined).problem).toMatch(/at least 5/);
    expect(cleanReason('x'.repeat(201)).problem).toMatch(/under 200/);
  });
});

describe('the answer', () => {
  it('keeps a real position', () => {
    expect(cleanAnswer({ lat: 47.6, lng: -122.3, accuracy: 20 })).toEqual({ lat: 47.6, lng: -122.3, accuracyM: 20 });
    expect(cleanAnswer({ lat: '47.6', lng: '-122.3' })).toEqual({ lat: 47.6, lng: -122.3, accuracyM: null });
  });
  it('refuses what a map can’t use', () => {
    for (const bad of [null, {}, { lat: 0, lng: 0 }, { lat: 91, lng: 0 }, { lat: null, lng: 1 }, { lat: 'x', lng: 1 }, { lat: 47, lng: -122, accuracy: ANSWER_MAX_ACCURACY_M + 1 }, { lat: 47, lng: -122, accuracy: -1 }]) {
      expect(cleanAnswer(bad)).toBeNull();
    }
  });
});

describe('wording', () => {
  it('names who asked', () => {
    expect(askedNotice('Krish').body).toContain('Krish');
    expect(askedNotice('').body).toContain('Your manager');
    expect(requestLine('Kevin', 'pending')).toMatch(/Waiting/);
    expect(requestLine('Kevin', 'expired')).toMatch(/15 minutes/);
    expect(requestLine('Kevin', 'answered', t('2026-11-20T04:14:00Z'))).toMatch(/^Located Kevin at /);
  });
});
