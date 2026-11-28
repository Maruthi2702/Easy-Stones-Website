// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { shimFor } from '../../../mobile/src/host/protocol';
import type { Plugins } from '../../../mobile/src/host/protocol';
import HostRouter from '../../../mobile/src/host/router';
import { SpeechController } from '../../../mobile/src/speech/core';
import { speechPluginFor } from '../../../mobile/src/speech/plugin';
import { FakeClock, FakeRecognizer } from '../../../mobile/src/speech/fakes';

/**
 * The phone's `Speech` plugin, end to end without a phone: the website's REAL @capacitor/core → the shim the app injects → the router →
 * the plugin → the listener with a fake recognizer; and the events back the same way. Also the website's own wrapper (`listen()`).
 */
const rec = new FakeRecognizer();
const clock = new FakeClock();
const controller = new SpeechController(rec, clock);
const plugins: Plugins = { Speech: speechPluginFor(() => controller) };
const g = globalThis as unknown as Record<string, unknown>;

let wrapper: typeof import('../voiceAssistant/speechPlugin');
beforeAll(async () => {
  const router = new HostRouter(plugins, (script) => { new Function('window', script)(g); });
  g.ReactNativeWebView = { postMessage: (m: string) => { void router.handle(m); } };
  new Function('window', shimFor('ios', plugins))(g);
  wrapper = await import('../voiceAssistant/speechPlugin');
});

describe('Speech plugin over the bridge', () => {
  it('available() reports the phone, with no prompt', async () => {
    rec.perm = { granted: false, canAskAgain: true, status: 'undetermined' };
    expect(await wrapper.speechAvailability()).toEqual({ available: true, onDevice: true, permission: 'undetermined' });
    expect(rec.perm.granted).toBe(false);
    rec.perm = { granted: true, canAskAgain: true, status: 'granted' };
    expect((await wrapper.speechAvailability()).permission).toBe('granted');
  });

  it('requestPermission() answers { granted, canAskAgain }', async () => {
    rec.perm = { granted: false, canAskAgain: true, status: 'undetermined' };
    expect(await wrapper.getSpeech().requestPermission()).toEqual({ granted: true, canAskAgain: true });
  });

  it('start / partial / level / stop round-trip, chunks joined, and the hints reach the recognizer', async () => {
    const heard: string[] = []; const levels: number[] = [];
    const speech = wrapper.getSpeech();
    const a = await speech.addListener('partial', (d: { text: string }) => heard.push(d.text));
    const b = await speech.addListener('level', (d: { level: number }) => levels.push(d.level));
    await speech.start({ hints: ['Calacatta Gold', 'Cascade Fabrication'] });
    expect(rec.started.at(-1)?.contextualStrings).toEqual(['Calacatta Gold', 'Cascade Fabrication']);

    rec.said('visited cascade', false);
    rec.said('visited cascade fabrication', true);
    rec.said('they want calacatta', false);
    rec.emit('volumechange', { value: 5 });
    await vi.waitFor(() => expect(heard).toEqual(['visited cascade', 'visited cascade fabrication', 'visited cascade fabrication they want calacatta']));
    await vi.waitFor(() => expect(levels).toEqual([0.5]));

    const stopped = speech.stop();
    rec.said('', true); rec.emit('end', null);
    expect(await stopped).toEqual({ text: 'visited cascade fabrication they want calacatta' });
    await a.remove(); await b.remove();
    await vi.waitFor(() => expect(rec.listeners()).toBe(0));
  });

  it('a refused permission rejects start() with the native code', async () => {
    rec.perm = { granted: false, canAskAgain: false, status: 'denied' };
    await expect(wrapper.getSpeech().start({ hints: [] })).rejects.toMatchObject({ code: 'not-allowed' });
  });

  it('listen() gives the screens partial / level / error and a stop() with the text', async () => {
    rec.perm = { granted: true, canAskAgain: true, status: 'granted' };
    const partials: string[] = []; const errors: string[] = [];
    const l = await wrapper.listen(['Quartz']);
    l.onPartial((t) => partials.push(t));
    l.onError((c) => errors.push(c));
    rec.said('log a visit', false);
    rec.emit('error', { error: 'network', message: 'No connection' });
    await vi.waitFor(() => expect(partials).toEqual(['log a visit']));
    await vi.waitFor(() => expect(errors).toEqual(['network']));
    const text = l.stop();
    rec.emit('end', null);
    expect(await text).toBe('log a visit');
  });

  it('abort() stops listening', async () => {
    await (await wrapper.listen([])).abort();
    expect(rec.calls.at(-1)).toBe('abort');
  });
});
