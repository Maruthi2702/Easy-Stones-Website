import { describe, it, expect } from 'vitest';
import { createPresence, deviceFromUserAgent, IDLE_AFTER_MS, SAVE_EVERY_MS } from './presence.ts';

const MIN = 60 * 1000;

describe('deviceFromUserAgent', () => {
  it('tells phones, tablets and desktops apart', () => {
    expect(deviceFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari')).toBe('phone');
    expect(deviceFromUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari')).toBe('phone');
    expect(deviceFromUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari')).toBe('tablet');
    expect(deviceFromUserAgent('Mozilla/5.0 (Linux; Android 13; SM-X700) Safari')).toBe('tablet');
    expect(deviceFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome')).toBe('desktop');
    expect(deviceFromUserAgent(undefined)).toBe('desktop');
  });
});

describe('createPresence', () => {
  it('counts several tabs as one person, offline only when the last closes', () => {
    const p = createPresence();
    p.connect('a', 'u1', 'desktop', 0);
    p.connect('b', 'u1', 'desktop', 0);
    expect(p.snapshot(0)).toHaveLength(1);
    expect(p.snapshot(0)[0].tabs).toBe(2);
    expect(p.disconnect('a').offline).toBe(false);
    expect(p.snapshot(0)).toHaveLength(1);
    expect(p.disconnect('b').offline).toBe(true);
    expect(p.snapshot(0)).toEqual([]);
  });

  it('is active until IDLE_AFTER_MS without activity, then idle, then active again', () => {
    const p = createPresence();
    p.connect('a', 'u1', 'desktop', 0);
    expect(p.snapshot(IDLE_AFTER_MS - 1)[0].status).toBe('active');
    expect(p.snapshot(IDLE_AFTER_MS)[0].status).toBe('idle');
    p.activity('a', IDLE_AFTER_MS + 5);
    expect(p.snapshot(IDLE_AFTER_MS + 6)[0].status).toBe('active');
  });

  it('is active if any one tab is active, and shows that tab\'s device', () => {
    const p = createPresence();
    p.connect('desk', 'u1', 'desktop', 0);
    p.connect('phone', 'u1', 'phone', 0);
    p.activity('phone', 20 * MIN);
    const [row] = p.snapshot(21 * MIN);
    expect(row.status).toBe('active');
    expect(row.device).toBe('phone');
  });

  it('ignores activity and disconnects from unknown sockets', () => {
    const p = createPresence();
    expect(p.activity('nope')).toBe(false);
    expect(p.disconnect('nope')).toBeNull();
  });

  it('lists the most recently active person first', () => {
    const p = createPresence();
    p.connect('a', 'u1', 'desktop', 0);
    p.connect('b', 'u2', 'desktop', 0);
    p.activity('b', 5);
    expect(p.snapshot(10).map((r) => r.userId)).toEqual(['u2', 'u1']);
  });

  it('asks for a lastSeenAt save at most every SAVE_EVERY_MS, and again after going offline', () => {
    const p = createPresence();
    p.connect('a', 'u1', 'desktop', 0);
    expect(p.dueToSave('u1', 0)).toBe(true);
    expect(p.dueToSave('u1', SAVE_EVERY_MS - 1)).toBe(false);
    expect(p.dueToSave('u1', SAVE_EVERY_MS)).toBe(true);
    p.disconnect('a');
    p.connect('b', 'u1', 'desktop', SAVE_EVERY_MS + 1);
    expect(p.dueToSave('u1', SAVE_EVERY_MS + 1)).toBe(true);
  });
});
