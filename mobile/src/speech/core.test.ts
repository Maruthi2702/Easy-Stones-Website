import { describe, expect, it } from 'vitest';
import {
  ABORT_WAIT_MS, LEVEL_EVERY_MS, SILENCE_STOP_MS, STOP_WAIT_MS, TOTAL_STOP_MS, SpeechController, cleanHints, levelFor
} from './core';
import { addResult, emptyHeard, heardText } from './heard';
import { FakeClock, FakeRecognizer, flush } from './fakes';

function setup() {
  const rec = new FakeRecognizer();
  const clock = new FakeClock();
  const ctl = new SpeechController(rec, clock);
  const partials: string[] = [];
  const levels: number[] = [];
  const errors: { code: string; message: string }[] = [];
  ctl.on('partial', (d) => partials.push(d.text));
  ctl.on('level', (d) => levels.push(d.level));
  ctl.on('error', (d) => errors.push(d));
  return { rec, clock, ctl, partials, levels, errors };
}
async function started(over: (r: FakeRecognizer) => void = () => {}) {
  const x = setup();
  over(x.rec);
  await x.ctl.start({ hints: ['Calacatta Gold'] });
  return x;
}

describe('joining chunks (shared with the speech test)', () => {
  it('keeps earlier chunks across a pause and ignores empty reports', () => {
    let h = addResult(emptyHeard, 'visited cascade', false);
    h = addResult(h, 'visited cascade fabrication', true);
    h = addResult(h, 'and they want', false);          // a new chunk starts after the pause
    expect(heardText(h)).toBe('visited cascade fabrication and they want');
    expect(heardText(addResult(h, '', true))).toBe('visited cascade fabrication and they want');
  });
});

describe('start', () => {
  it('starts the recognizer with the defaults and the cleaned hints', async () => {
    const { rec, ctl } = setup();
    await ctl.start({ hints: ['  Calacatta Gold ', 'calacatta gold', '', 'Cascade Fab'] });
    expect(rec.started[0]).toMatchObject({
      lang: 'en-US', interimResults: true, continuous: true, addsPunctuation: false, requiresOnDeviceRecognition: true,
      contextualStrings: ['Calacatta Gold', 'Cascade Fab'], volumeChangeEventOptions: { enabled: true }
    });
  });
  it('does not require on-device recognition where the phone cannot do it', async () => {
    const { rec, ctl } = setup();
    rec.onDevice = false;
    await ctl.start({ hints: [] });
    expect(rec.started[0].requiresOnDeviceRecognition).toBe(false);
    expect(rec.started[0].contextualStrings).toBeUndefined();
  });
  it('resolves after the wait if the recognizer never says it started', async () => {
    const { rec, ctl, clock } = setup();
    rec.autoStart = false;
    let done = false;
    const p = ctl.start({ hints: [] }).then(() => { done = true; });
    await flush();
    expect(done).toBe(false);
    clock.advance(3000);
    await p;
    expect(done).toBe(true);
  });
  it('refuses without permission and never starts', async () => {
    const { rec, ctl } = setup();
    rec.perm = { granted: false, canAskAgain: false, status: 'denied' };
    await expect(ctl.start({ hints: [] })).rejects.toMatchObject({ code: 'not-allowed' });
    expect(rec.calls).not.toContain('start');
  });
  it('asks once when the permission is undecided, then goes ahead', async () => {
    const { rec, ctl } = setup();
    rec.perm = { granted: false, canAskAgain: true, status: 'undetermined' };
    await ctl.start({ hints: [] });
    expect(rec.calls).toContain('start');
  });
  it('refuses when the person says no to the prompt', async () => {
    const { rec, ctl } = setup();
    rec.perm = { granted: false, canAskAgain: true, status: 'undetermined' };
    rec.willGrant = false;
    await expect(ctl.start({ hints: [] })).rejects.toMatchObject({ code: 'not-allowed' });
  });
});

describe('partial text', () => {
  it('sends everything heard so far, and a pause keeps the earlier words', async () => {
    const { rec, partials } = await started();
    rec.said('visited cascade');
    rec.said('visited cascade fabrication', true);          // pause: the chunk is final
    rec.said('they want calacatta');                        // the next chunk starts again from nothing
    rec.said('they want calacatta gold');
    expect(partials).toEqual([
      'visited cascade', 'visited cascade fabrication', 'visited cascade fabrication they want calacatta', 'visited cascade fabrication they want calacatta gold'
    ]);
  });
  it('does not repeat a partial that did not change, and skips empty reports', async () => {
    const { rec, partials } = await started();
    rec.said('hello');
    rec.said('hello');
    rec.said('', false);
    expect(partials).toEqual(['hello']);
  });
});

describe('stop', () => {
  it('answers with the final text once the recognizer ends', async () => {
    const { rec, ctl } = await started();
    rec.said('visited cascade', false);
    const p = ctl.stop();
    expect(rec.calls.at(-1)).toBe('stop');
    rec.said('visited cascade fabrication today', true);   // the last result arrives after stop()
    rec.emit('end', null);
    expect(await p).toEqual({ text: 'visited cascade fabrication today' });
    expect(rec.listeners()).toBe(0);
  });
  it('never answers empty when words were heard, even if the closing report is empty (2026-11-28)', async () => {
    const { rec, ctl } = await started();
    rec.said('took samples to cascade', false);
    const p = ctl.stop();
    rec.said('', true);
    rec.emit('end', null);
    expect(await p).toEqual({ text: 'took samples to cascade' });
  });
  it('keeps the words of an earlier chunk when the closing report is a new empty chunk', async () => {
    const { rec, ctl } = await started();
    rec.said('first part', true);
    rec.said('second part', false);
    const p = ctl.stop();
    rec.said('', true); rec.emit('end', null);
    expect((await p).text).toBe('first part second part');
  });
  it('gives up waiting after 1.5 s, aborts the recognizer and still answers what it has', async () => {
    const { rec, ctl, clock } = await started();
    rec.said('some words');
    const p = ctl.stop();
    clock.advance(STOP_WAIT_MS);
    expect(await p).toEqual({ text: 'some words' });
    expect(rec.calls).toContain('abort');
  });
  it('shares one answer between two stop() calls and answers again after it', async () => {
    const { rec, ctl } = await started();
    rec.said('same words');
    const a = ctl.stop(); const b = ctl.stop();
    rec.emit('end', null);
    expect(await a).toEqual({ text: 'same words' });
    expect(await b).toEqual({ text: 'same words' });
    expect(await ctl.stop()).toEqual({ text: 'same words' });
    expect(rec.calls.filter((c) => c === 'stop')).toHaveLength(1);
  });
  it('is empty with nothing said, and without a session', async () => {
    const x = setup();
    expect(await x.ctl.stop()).toEqual({ text: '' });
    await x.ctl.start({ hints: [] });
    const p = x.ctl.stop(); x.rec.emit('error', { error: 'no-speech', message: 'none' }); x.rec.emit('end', null);
    expect(await p).toEqual({ text: '' });
    expect(x.errors).toEqual([]);                          // "no speech" after a stop is an ordinary ending
  });
});

describe('stopping by itself', () => {
  it('stops after 20 s of quiet following speech, tells the screen, and keeps the words for stop()', async () => {
    const { rec, ctl, clock, errors } = await started();
    rec.said('log a visit at cascade');
    clock.advance(SILENCE_STOP_MS - 1);
    expect(errors).toEqual([]);
    clock.advance(1);
    expect(errors.map((e) => e.code)).toEqual(['auto-stopped']);
    expect(rec.calls.at(-1)).toBe('stop');
    rec.emit('end', null);
    expect(await ctl.stop()).toEqual({ text: 'log a visit at cascade' });
  });
  it('more speech restarts the 20 s', async () => {
    const { rec, clock, errors } = await started();
    rec.said('one');
    clock.advance(15_000);
    rec.said('one two');
    clock.advance(15_000);
    expect(errors).toEqual([]);
    clock.advance(5_000);
    expect(errors).toHaveLength(1);
  });
  it('stops after 60 s in all, even if nothing was said', async () => {
    const { rec, ctl, clock, errors } = await started();
    clock.advance(TOTAL_STOP_MS);
    expect(errors.map((e) => e.code)).toEqual(['auto-stopped']);
    rec.emit('end', null);
    expect(await ctl.stop()).toEqual({ text: '' });
  });
  it('a stop() the screen sends after the timer is answered by the same wait', async () => {
    const { rec, ctl, clock } = await started();
    rec.said('words');
    clock.advance(SILENCE_STOP_MS);
    const p = ctl.stop();
    rec.emit('end', null);
    expect((await p).text).toBe('words');
    expect(rec.calls.filter((c) => c === 'stop')).toHaveLength(1);
  });
  it('the recognizer ending on its own is reported, and the words are kept', async () => {
    const { rec, ctl, errors } = await started();
    rec.said('half a thought');
    rec.emit('end', null);
    expect(errors.map((e) => e.code)).toEqual(['ended']);
    expect(await ctl.stop()).toEqual({ text: 'half a thought' });
  });
});

describe('errors', () => {
  it('passes a real error on and keeps what was heard; "aborted" is not one', async () => {
    const { rec, ctl, errors } = await started();
    rec.said('before the network dropped');
    rec.emit('error', { error: 'aborted', message: 'x' });
    rec.emit('error', { error: 'network', message: 'No connection' });
    rec.emit('end', null);
    expect(errors).toEqual([{ code: 'network', message: 'No connection' }]);   // no extra "ended"
    expect(await ctl.stop()).toEqual({ text: 'before the network dropped' });
  });
  it('treats a fatal error with no end as the end after a second', async () => {
    const { rec, ctl, clock } = await started();
    rec.said('words');
    rec.emit('error', { error: 'audio-capture', message: 'mic' });
    clock.advance(1000);
    expect(rec.listeners()).toBe(0);
    expect(await ctl.stop()).toEqual({ text: 'words' });
  });
});

describe('level', () => {
  it('normalises the volume to 0..1', () => {
    expect(levelFor(-2)).toBe(0);
    expect(levelFor(5)).toBe(0.5);
    expect(levelFor(40)).toBe(1);
    expect(levelFor(NaN)).toBe(0);
  });
  it('sends about 15 a second, not every event', async () => {
    const { rec, clock, levels } = await started();
    for (let i = 0; i < 100; i++) { rec.emit('volumechange', { value: 5 }); clock.advance(10); }   // 100 events in one second
    expect(levels.length).toBeGreaterThanOrEqual(14);
    expect(levels.length).toBeLessThanOrEqual(16);
    expect(levels[0]).toBe(0.5);
    clock.advance(LEVEL_EVERY_MS);
    rec.emit('volumechange', { value: 10 });
    expect(levels.at(-1)).toBe(1);
  });
  it('sends nothing after stop', async () => {
    const { rec, ctl, clock, levels } = await started();
    const p = ctl.stop();
    clock.advance(1000);
    rec.emit('volumechange', { value: 8 });
    rec.emit('end', null);
    await p;
    expect(levels).toEqual([]);
  });
});

describe('restart and abort', () => {
  it('a new start() aborts the old session first and its late events never reach the new one', async () => {
    const { rec, ctl, partials } = await started();
    rec.said('old words');
    rec.autoEndOnAbort = false;
    const p = ctl.start({ hints: [] });
    await flush();
    expect(rec.calls.filter((c) => c === 'start')).toHaveLength(1);       // the new one waits for the old to end
    rec.said('late old words', true);
    rec.emit('end', null);
    await p;
    expect(rec.calls.filter((c) => c === 'start')).toHaveLength(2);
    rec.said('new words');
    expect(partials.at(-1)).toBe('new words');
    expect(partials).not.toContain('late old words');
    rec.emit('end', null);
    expect(await ctl.stop()).toEqual({ text: 'new words' });
  });
  it('does not wait forever for the old session to end', async () => {
    const { rec, ctl, clock } = await started();
    rec.autoEndOnAbort = false;
    const p = ctl.start({ hints: [] });
    await flush();
    clock.advance(ABORT_WAIT_MS);
    await p;
    expect(rec.calls.filter((c) => c === 'start')).toHaveLength(2);
  });
  it('answers a stop() that was waiting when the session is replaced', async () => {
    const { rec, ctl } = await started();
    rec.said('first session words');
    const pending = ctl.stop();
    await ctl.start({ hints: [] });
    expect((await pending).text).toBe('first session words');
  });
  it('abort() stops now, drops the session and its listeners', async () => {
    const { rec, ctl, partials } = await started();
    rec.said('words');
    await ctl.abort();
    expect(rec.calls).toContain('abort');
    expect(rec.listeners()).toBe(0);
    rec.said('after abort');
    expect(partials).toEqual(['words']);
    expect(await ctl.stop()).toEqual({ text: '' });
  });
});

describe('available and permission', () => {
  it('reports on-device and the permission without asking', async () => {
    const { rec, ctl } = setup();
    rec.perm = { granted: false, canAskAgain: true, status: 'undetermined' };
    expect(await ctl.available()).toEqual({ available: true, onDevice: true, permission: 'undetermined' });
    expect(rec.perm.granted).toBe(false);
    rec.perm = { granted: false, canAskAgain: false, status: 'denied' };
    expect((await ctl.available()).permission).toBe('denied');
    rec.perm = { granted: true, canAskAgain: true, status: 'granted' };
    rec.onDevice = false;
    expect(await ctl.available()).toEqual({ available: true, onDevice: false, permission: 'granted' });
  });
  it('is unavailable where the recognizer is', async () => {
    const { rec, ctl } = setup();
    rec.available = false;
    expect((await ctl.available()).available).toBe(false);
  });
  it('requestPermission answers granted / canAskAgain', async () => {
    const { rec, ctl } = setup();
    rec.perm = { granted: false, canAskAgain: true, status: 'undetermined' };
    expect(await ctl.requestPermission()).toEqual({ granted: true, canAskAgain: true });
    rec.perm = { granted: false, canAskAgain: true, status: 'undetermined' };
    rec.willGrant = false;
    expect(await ctl.requestPermission()).toEqual({ granted: false, canAskAgain: false });
  });
});

describe('cleanHints', () => {
  it('trims, drops repeats in any case, and caps at 100', () => {
    expect(cleanHints([' a  b ', 'A B', 5, '', 'c'])).toEqual(['a b', 'c']);
    expect(cleanHints(Array.from({ length: 150 }, (_, i) => `word ${i}`))).toHaveLength(100);
    expect(cleanHints(undefined)).toEqual([]);
  });
});
