// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { shimFor } from '../../../mobile/src/host/protocol';
import type { Plugins } from '../../../mobile/src/host/protocol';
import HostRouter from '../../../mobile/src/host/router';

/** An app build from before the Speech plugin: a real @capacitor/core on a host that has other plugins but no `Speech`. */
const plugins: Plugins = { App: { calls: {}, callbacks: {}, events: {} } };
const g = globalThis as unknown as Record<string, unknown>;
let wrapper: typeof import('./speechPlugin');
beforeAll(async () => {
  const router = new HostRouter(plugins, (script) => { new Function('window', script)(g); });
  g.ReactNativeWebView = { postMessage: (m: string) => { void router.handle(m); } };
  new Function('window', shimFor('ios', plugins))(g);
  wrapper = await import('./speechPlugin');
});

describe('an old app build', () => {
  it('says the mic is not available, without throwing', async () => {
    expect(await wrapper.speechAvailability()).toEqual({ available: false, onDevice: false, permission: 'undetermined' });
  });
  it('listen() rejects instead of hanging', async () => {
    await expect(wrapper.listen([])).rejects.toBeTruthy();
  });
});
