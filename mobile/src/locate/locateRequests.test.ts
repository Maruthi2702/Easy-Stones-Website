import { describe, expect, it } from 'vitest';
import { ASK_EVERY_MS, makeAnswerer, type LocatePorts } from './locateRequests';

const HERE = { lat: 47.6, lng: -122.3, accuracy: 8 };

function setup(over: Partial<LocatePorts> = {}) {
  const t = { now: 1_000_000 };
  const sent: { id: string; at: unknown }[] = [];
  let loads = 0;
  const ports: LocatePorts = {
    now: () => t.now,
    load: async () => { loads++; return [{ id: 'a1', requestedByName: 'Maria' }]; },
    position: async () => HERE,
    send: async (id, at) => { sent.push({ id, at }); return true; },
    ...over
  };
  return { t, sent, loads: () => loads, run: makeAnswerer(ports) };
}

describe('answering Locate now from the phone', () => {
  it('sends one position for an open ask', async () => {
    const { run, sent } = setup();
    expect(await run()).toBe(1);
    expect(sent).toEqual([{ id: 'a1', at: HERE }]);
  });

  it('answers nothing when no ask is open and takes no position', async () => {
    let asked = 0;
    const { run } = setup({ load: async () => [], position: async () => { asked++; return HERE; } });
    expect(await run()).toBe(0);
    expect(asked).toBe(0);
  });

  it('does not answer the same ask twice, even if the server is slow to close it', async () => {
    const { run, sent, t } = setup();
    await run();
    t.now += ASK_EVERY_MS + 1;
    await run();
    expect(sent).toHaveLength(1);
  });

  it('looks at most once a minute, unless forced', async () => {
    const { run, loads, t } = setup();
    await run();
    t.now += 10_000; await run();
    expect(loads()).toBe(1);
    await run(true);
    expect(loads()).toBe(2);
    t.now += ASK_EVERY_MS; await run();
    expect(loads()).toBe(3);
  });

  it('keeps the ask open when there is no position, and tries again', async () => {
    let here: typeof HERE | null = null;
    const { run, sent, t } = setup({ position: async () => here });
    expect(await run()).toBe(0);
    here = HERE; t.now += ASK_EVERY_MS;
    expect(await run()).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it('keeps the ask open when the server does not take the answer', async () => {
    let ok = false;
    const { run, sent, t } = setup({ send: async (id, at) => { sent.push({ id, at }); return ok; } });
    expect(await run()).toBe(0);
    ok = true; t.now += ASK_EVERY_MS;
    expect(await run()).toBe(1);
    expect(sent).toHaveLength(2);
  });

  it('runs one at a time', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const { run, loads } = setup({ load: async () => { await gate; return []; } });
    const first = run();
    expect(await run(true)).toBe(0);
    release(); await first;
    expect(loads()).toBe(0);   // the blocked second call never reached the server
  });
});
