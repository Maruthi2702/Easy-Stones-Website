import { describe, it, expect, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { createBreaker, createVisitExtractor, BREAKER_FAILURES, BREAKER_OPEN_MS } from './visitExtract.ts';
import type { SpokenType } from '../utils/assistantVisit.ts';

const types: SpokenType[] = [{ name: 'Quick Note', label: 'Quick note', active: true, fields: { notes: true, outcome: false, followUp: 'none' } }];
const today = '2026-11-27';
const GOOD = { customerQuery: 'Smith Granite', cityHint: '', visitType: 'Quick Note', visitDate: '', notes: 'Dropped samples', outcome: '', followUp: '', followUpDate: '' };
const reply = (over: Record<string, unknown> = {}) => ({
  model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(GOOD) }],
  usage: { input_tokens: 40, output_tokens: 20, cache_read_input_tokens: 1500, cache_creation_input_tokens: 0 }, ...over
});
const serverError = () => Anthropic.APIError.generate(500, { type: 'error' }, 'boom', new Headers());
const badRequest = () => Anthropic.APIError.generate(400, { type: 'error' }, 'bad', new Headers());

function extractorWith(create: (p: Record<string, unknown>) => unknown, now = () => 0) {
  const breaker = createBreaker({ now });
  const sleep = vi.fn(async () => {});
  const extractor = createVisitExtractor({ apiKey: 'k', client: { beta: { messages: { create } } }, breaker, sleep })!;
  return { extractor, breaker, sleep };
}
const ask = (e: ReturnType<typeof extractorWith>['extractor'], extra = {}) => e.extract('dropped samples at smith granite', { types, today, ...extra });

describe('the call', () => {
  it('sends the stable instruction first and cacheable, the request last, and offers no tools', async () => {
    const create = vi.fn(async (_p: Record<string, unknown>) => reply());
    const { extractor } = extractorWith(create);
    const r = await ask(extractor, { asking: 'notes', glossary: 'GLOSS' });
    expect(r.ok && r.visit.customerQuery).toBe('Smith Granite');
    expect(r.ok && r.usage).toEqual({ input: 40, output: 20, cacheRead: 1500, cacheWrite: 0 });
    const p = create.mock.calls[0][0] as Record<string, any>;
    expect(p.model).toBe('claude-haiku-5-5');
    expect(p.tools).toBeUndefined();
    expect(p.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(p.system[0].text).toContain('GLOSS');
    expect(p.system[0].text).not.toContain('dropped samples');
    expect(p.messages[0].content[0].text).toContain('<transcript>\ndropped samples at smith granite\n</transcript>');
    expect(p.messages[0].content[0].text).toContain('Friday 2026-11-27');
  });
  it('does not change its cacheable start from one request to the next', async () => {
    const create = vi.fn(async (_p: Record<string, unknown>) => reply());
    const { extractor } = extractorWith(create);
    await extractor.extract('one', { types, today: '2026-11-27', glossary: 'G' });
    await extractor.extract('two', { types, today: '2026-11-28', asking: 'type', glossary: 'G' });
    const [a, b] = create.mock.calls.map((c) => (c[0] as Record<string, any>).system[0].text);
    expect(a).toBe(b);
  });
});

describe('failing and recovering', () => {
  it('retries once after a server error, then succeeds', async () => {
    const create = vi.fn().mockRejectedValueOnce(serverError()).mockResolvedValueOnce(reply());
    const { extractor, sleep } = extractorWith(create);
    expect((await ask(extractor)).ok).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
  it('gives up after the one retry', async () => {
    const create = vi.fn(async () => { throw serverError(); });
    const { extractor } = extractorWith(create);
    const r = await ask(extractor);
    expect(r).toMatchObject({ ok: false, reason: 'failed' });
    expect(create).toHaveBeenCalledTimes(2);
  });
  it('does not retry a request that would only fail again', async () => {
    const create = vi.fn(async () => { throw badRequest(); });
    const { extractor } = extractorWith(create);
    expect(await ask(extractor)).toMatchObject({ ok: false, reason: 'failed' });
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('retries a timeout', async () => {
    const create = vi.fn().mockRejectedValueOnce(new Anthropic.APIConnectionTimeoutError()).mockResolvedValueOnce(reply());
    const { extractor } = extractorWith(create);
    expect((await ask(extractor)).ok).toBe(true);
  });
  it('after three failures in a row answers at once for 30 s, then lets one through', async () => {
    let t = 1000;
    const create = vi.fn(async () => { throw badRequest(); });
    const { extractor } = extractorWith(create, () => t);
    for (let i = 0; i < BREAKER_FAILURES; i++) await ask(extractor);
    expect(create).toHaveBeenCalledTimes(BREAKER_FAILURES);
    const shorted = await ask(extractor);
    expect(shorted).toMatchObject({ ok: false, reason: 'failed', shortCircuited: true, ms: 0 });
    expect(create).toHaveBeenCalledTimes(BREAKER_FAILURES);
    t += BREAKER_OPEN_MS + 1;
    create.mockImplementation(async () => reply() as never);
    expect((await ask(extractor)).ok).toBe(true);
    expect(create).toHaveBeenCalledTimes(BREAKER_FAILURES + 1);
    expect((await ask(extractor)).ok).toBe(true); // closed again
  });
  it('a refusal or unreadable answer is Claude answering, not Claude down', async () => {
    const create = vi.fn(async () => reply({ stop_reason: 'refusal' }));
    const { extractor, breaker } = extractorWith(create);
    for (let i = 0; i < 5; i++) expect(await ask(extractor)).toMatchObject({ ok: false, reason: 'refused' });
    expect(breaker.allow()).toBe(true);
    create.mockResolvedValueOnce(reply({ content: [{ type: 'text', text: 'not json' }] }) as never);
    expect(await ask(extractor)).toMatchObject({ ok: false, reason: 'unreadable', usage: { output: 20 } });
    create.mockResolvedValueOnce(reply({ stop_reason: 'max_tokens' }) as never);
    expect(await ask(extractor)).toMatchObject({ ok: false, reason: 'unreadable' });
  });
  it('is off without a key', () => {
    expect(createVisitExtractor({ apiKey: '' })).toBeNull();
  });
});
