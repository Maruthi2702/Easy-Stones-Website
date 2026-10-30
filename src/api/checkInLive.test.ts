// @vitest-environment jsdom
// Keeping the Check-In Log live: joining with a fresh token, and reloading
// after a reconnect or the page coming back on screen.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Socket } from 'socket.io-client';
import { setAuthToken, clearAuthToken, getAuthToken } from './authToken';
import { followCheckIns } from './checkInLive';

type Ack = (res: { ok?: boolean } | undefined) => void;

const fakeSocket = () => {
  const handlers: Record<string, () => void> = {};
  const joins: { token: string; ack: Ack }[] = [];
  const socket = {
    connected: false,
    on: (event: string, fn: () => void) => { handlers[event] = fn; },
    emit: (event: string, payload: { token: string }, ack: Ack) => {
      if (event === 'join_checkin_rooms') joins.push({ token: payload.token, ack });
    },
    connect: vi.fn()
  };
  const connect = () => { socket.connected = true; handlers.connect(); };
  return { socket, live: socket as unknown as Socket, joins, connect };
};

const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

let stop: () => void = () => {};
beforeEach(() => { setAuthToken('old'); });
afterEach(() => { stop(); clearAuthToken(); vi.unstubAllGlobals(); });

describe('followCheckIns', () => {
  it('joins on connect and reloads only on a reconnect', () => {
    const { socket, live, joins, connect } = fakeSocket();
    const resync = vi.fn();
    stop = followCheckIns(live, resync);
    connect();
    expect(joins.map(j => j.token)).toEqual(['old']);
    expect(resync).not.toHaveBeenCalled();
    socket.connected = false;
    connect();
    expect(joins).toHaveLength(2);
    expect(resync).toHaveBeenCalledTimes(1);
  });

  it('a refused join fetches a fresh token once and rejoins with it', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ token: 'new' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { live, joins, connect } = fakeSocket();
    stop = followCheckIns(live, vi.fn());
    connect();
    await joins[0].ack({ ok: false });
    expect(getAuthToken()).toBe('new');
    expect(joins.map(j => j.token)).toEqual(['old', 'new']);
    // Refused again: no loop of token fetches.
    await joins[1].ack({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a join that worked fetches nothing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { live, joins, connect } = fakeSocket();
    stop = followCheckIns(live, vi.fn());
    connect();
    await joins[0].ack({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waits for a token, and rejoins when it arrives', () => {
    clearAuthToken();
    const { live, joins, connect } = fakeSocket();
    stop = followCheckIns(live, vi.fn());
    connect();
    expect(joins).toHaveLength(0);
    setAuthToken('late');
    expect(joins.map(j => j.token)).toEqual(['late']);
  });

  it('coming back on screen reloads, and reconnects a dropped socket', () => {
    const { socket, live, connect } = fakeSocket();
    const resync = vi.fn();
    stop = followCheckIns(live, resync);
    connect();
    setVisibility('hidden');
    expect(resync).not.toHaveBeenCalled();
    socket.connected = false;
    setVisibility('visible');
    expect(resync).toHaveBeenCalledTimes(1);
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });

  it('stops listening after cleanup', () => {
    const { live, joins, connect } = fakeSocket();
    const resync = vi.fn();
    followCheckIns(live, resync)();
    connect();
    setAuthToken('other');
    setVisibility('visible');
    expect(joins).toHaveLength(1); // the connect's own join, not the token change
    expect(resync).not.toHaveBeenCalled();
  });
});
