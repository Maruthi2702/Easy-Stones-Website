// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authFetch = vi.fn();
vi.mock('../../api/authFetch', () => ({ authFetch: (...args: unknown[]) => authFetch(...args) }));

const api = await import('./assistantApi');

const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const REQUEST = { text: 'log a visit at Smith Granite', today: '2026-11-28' };
const DRAFT = { customerQuery: 'Smith Granite', cityHint: '', visitType: '', visitDate: '', notes: '', outcome: '', followUp: '', followUpDate: '' };

beforeEach(() => { authFetch.mockReset(); api.resetWordsCache(); window.localStorage.clear(); vi.useRealTimers(); });
afterEach(() => vi.useRealTimers());

describe('postTurn', () => {
  it('sends the words and today, and returns the draft', async () => {
    authFetch.mockResolvedValue(reply(200, { ok: true, draft: DRAFT }));
    const r = await api.postTurn({ ...REQUEST, asking: 'type', draft: DRAFT });
    expect(r).toEqual({ ok: true, draft: DRAFT });
    const [url, init] = authFetch.mock.calls[0];
    expect(String(url)).toContain('/api/assistant/turn');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ ...REQUEST, asking: 'type', draft: DRAFT });
  });
  it('passes on the model failures the server reports as 200', async () => {
    for (const reason of ['empty', 'refused', 'unreadable', 'failed', 'busy']) {
      authFetch.mockResolvedValue(reply(200, { ok: false, reason, message: 'x' }));
      expect(await api.postTurn(REQUEST)).toMatchObject({ ok: false, reason });
    }
  });
  it('treats an unknown failure or a body with no draft as "failed"', async () => {
    authFetch.mockResolvedValue(reply(200, { ok: false, reason: 'weird', message: '' }));
    expect(await api.postTurn(REQUEST)).toMatchObject({ ok: false, reason: 'failed' });
    authFetch.mockResolvedValue(reply(200, { ok: true }));
    expect(await api.postTurn(REQUEST)).toMatchObject({ ok: false, reason: 'failed' });
  });
  it('maps 429, 503, 401/403, other errors and no signal', async () => {
    authFetch.mockResolvedValue(reply(429, { message: 'Daily limit', retryAfterSeconds: 120 }));
    expect(await api.postTurn(REQUEST)).toEqual({ ok: false, reason: 'limit', message: 'Daily limit', retryAfterSeconds: 120 });
    authFetch.mockResolvedValue(reply(503, {}));
    expect(await api.postTurn(REQUEST)).toMatchObject({ ok: false, reason: 'unavailable' });
    authFetch.mockResolvedValue(reply(403, {}));
    expect(await api.postTurn(REQUEST)).toMatchObject({ ok: false, reason: 'forbidden' });
    authFetch.mockResolvedValue(reply(401, {}));
    expect(await api.postTurn(REQUEST)).toMatchObject({ ok: false, reason: 'forbidden' });
    authFetch.mockResolvedValue(reply(500, {}));
    expect(await api.postTurn(REQUEST)).toMatchObject({ ok: false, reason: 'failed' });
    authFetch.mockResolvedValue(reply(400, { message: 'Bad body' }));
    expect(await api.postTurn(REQUEST)).toMatchObject({ ok: false, reason: 'failed', message: 'Bad body' });
    authFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await api.postTurn(REQUEST)).toMatchObject({ ok: false, reason: 'network' });
  });
  it('survives an answer that is not JSON', async () => {
    authFetch.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('html'); } });
    expect(await api.postTurn(REQUEST)).toMatchObject({ ok: false, reason: 'failed' });
  });
});

describe('the cached word list', () => {
  const V1 = { version: 'v1', hints: ['Calacatta Gold', 'Quartzite'] };
  const V2 = { version: 'v2', hints: ['Calacatta Gold', 'Taj Mahal'] };

  it('loads once, keeps it in memory and in storage, and answers from the cache after', async () => {
    authFetch.mockResolvedValue(reply(200, V1));
    expect(await api.loadWords()).toEqual(V1);
    expect(JSON.parse(window.localStorage.getItem('assistant.words.v1')!)).toEqual(V1);
    expect(await api.loadWords()).toEqual(V1);
    expect(authFetch).toHaveBeenCalledTimes(1);
  });
  it('starts from storage after a restart, then re-reads when the cache is old', async () => {
    window.localStorage.setItem('assistant.words.v1', JSON.stringify(V1));
    expect(api.cachedWords()).toEqual(V1);
    authFetch.mockResolvedValue(reply(200, V2));
    expect(await api.loadWords()).toEqual(V2);
    expect(authFetch).toHaveBeenCalledTimes(1);
  });
  it('replaces the copy only when the version differs', async () => {
    authFetch.mockResolvedValue(reply(200, V1));
    await api.loadWords();
    authFetch.mockResolvedValue(reply(200, { version: 'v1', hints: ['changed but same version'] }));
    expect(await api.loadWords({ force: true })).toEqual(V1);
    authFetch.mockResolvedValue(reply(200, V2));
    expect(await api.loadWords({ force: true })).toEqual(V2);
    expect(JSON.parse(window.localStorage.getItem('assistant.words.v1')!)).toEqual(V2);
  });
  it('asks again after the refresh time has passed', async () => {
    vi.useFakeTimers();
    authFetch.mockResolvedValue(reply(200, V1));
    await api.loadWords();
    vi.setSystemTime(Date.now() + api.WORDS_REFRESH_MS + 1000);
    authFetch.mockResolvedValue(reply(200, V2));
    expect(await api.loadWords()).toEqual(V2);
  });
  it('keeps the cached list when the server fails or is unreachable', async () => {
    authFetch.mockResolvedValue(reply(200, V1));
    await api.loadWords();
    authFetch.mockResolvedValue(reply(500, {}));
    expect(await api.loadWords({ force: true })).toEqual(V1);
    authFetch.mockRejectedValue(new Error('offline'));
    expect(await api.loadWords({ force: true })).toEqual(V1);
    authFetch.mockResolvedValue(reply(200, { nonsense: true }));
    expect(await api.loadWords({ force: true })).toEqual(V1);
  });
  it('is null with nothing cached and the server down', async () => {
    authFetch.mockRejectedValue(new Error('offline'));
    expect(await api.loadWords()).toBeNull();
  });
  it('shares one request between callers at the same time', async () => {
    authFetch.mockResolvedValue(reply(200, V1));
    await Promise.all([api.loadWords(), api.loadWords(), api.loadWords()]);
    expect(authFetch).toHaveBeenCalledTimes(1);
  });
  it('forgets everything on sign-out', async () => {
    authFetch.mockResolvedValue(reply(200, V1));
    await api.loadWords();
    api.resetWordsCache();
    expect(api.cachedWords()).toBeNull();
    expect(window.localStorage.getItem('assistant.words.v1')).toBeNull();
  });
  it('ignores a damaged stored copy', () => {
    window.localStorage.setItem('assistant.words.v1', '{not json');
    expect(api.cachedWords()).toBeNull();
    window.localStorage.setItem('assistant.words.v1', JSON.stringify({ version: 1 }));
    expect(api.cachedWords()).toBeNull();
  });
});

describe('buildHints', () => {
  it('puts the rep\'s recent customers first, then the company words, with no repeats', () => {
    const hints = api.buildHints({ version: 'v', hints: ['Calacatta Gold', 'smith granite', 'Quartzite'] }, ['Smith Granite', 'Cascade Fabrication']);
    expect(hints).toEqual(['Smith Granite', 'Cascade Fabrication', 'Calacatta Gold', 'Quartzite']);
  });
  it('caps at 100 and drops blanks', () => {
    const many = Array.from({ length: 150 }, (_, i) => `Word ${i}`);
    const hints = api.buildHints({ version: 'v', hints: ['', '  ', ...many] }, ['Recent']);
    expect(hints.length).toBe(100);
    expect(hints[0]).toBe('Recent');
    expect(hints).not.toContain('');
  });
  it('works with no list at all', () => {
    expect(api.buildHints(null, ['Smith Granite'])).toEqual(['Smith Granite']);
    expect(api.buildHints(undefined)).toEqual([]);
  });
});
