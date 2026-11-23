import type { Emit, Fail, Plugins } from './protocol';

type Incoming = { t: 'call' | 'callback'; id: string; plugin: string; method: string; options: any };

/** Answers the website's native calls (protocol.ts). One router per WebView; `reset()` when the page reloads. */
export default class HostRouter {
  private cleanups = new Map<string, () => void>();
  private plugins: Plugins;
  private send: (script: string) => void;
  constructor(plugins: Plugins, send: (script: string) => void) { this.plugins = plugins; this.send = send; }

  private reply(message: object) { this.send(`window.__easyHostReply(${JSON.stringify(message)});true;`); }

  reset() {
    for (const stop of this.cleanups.values()) { try { stop(); } catch { /* already stopped */ } }
    this.cleanups.clear();
  }

  async handle(raw: string): Promise<void> {
    let m: Incoming;
    try { m = JSON.parse(raw) as Incoming; } catch { return; }
    if (!m || typeof m.id !== 'string' || typeof m.plugin !== 'string') return;
    const plugin = this.plugins[m.plugin];
    if (m.t === 'call') return this.call(plugin, m);
    if (m.t === 'callback') return this.callback(plugin, m);
  }

  private async call(plugin: Plugins[string] | undefined, m: Incoming) {
    try {
      if (m.method === 'removeListener') {
        const stop = this.cleanups.get(String(m.options?.callbackId));
        stop?.(); this.cleanups.delete(String(m.options?.callbackId));
        this.reply({ t: 'drop', id: String(m.options?.callbackId) });
        return this.reply({ t: 'result', id: m.id, ok: true, data: {} });
      }
      if (m.method === 'removeAllListeners') { return this.reply({ t: 'result', id: m.id, ok: true, data: {} }); }
      if (m.method === 'removeWatcher') this.stop(String(m.options?.id));      // BackgroundGeolocation: the id is the callback's id
      const fn = plugin?.calls[m.method];
      if (!fn) return this.reply({ t: 'result', id: m.id, ok: false, error: { message: `"${m.plugin}.${m.method}()" is not implemented`, code: 'UNIMPLEMENTED' } });
      const data = await fn(m.options ?? {});
      this.reply({ t: 'result', id: m.id, ok: true, data: data ?? {} });
    } catch (e) {
      const err = e as { message?: string; code?: string };
      this.reply({ t: 'result', id: m.id, ok: false, error: { message: err.message || 'Native call failed', code: err.code } });
    }
  }

  private async callback(plugin: Plugins[string] | undefined, m: Incoming) {
    const emit: Emit = (data) => this.reply({ t: 'event', id: m.id, data });
    const fail: Fail = (error) => this.reply({ t: 'event', id: m.id, error });
    try {
      if (m.method === 'addListener') {
        const start = plugin?.events[String(m.options?.eventName)];
        if (!start) return fail({ message: `No event "${m.options?.eventName}"`, code: 'UNIMPLEMENTED' });
        this.cleanups.set(m.id, await start(emit));
        return;
      }
      const start = plugin?.callbacks[m.method];
      if (!start) return fail({ message: `"${m.plugin}.${m.method}()" is not implemented`, code: 'UNIMPLEMENTED' });
      this.cleanups.set(m.id, await start(m.options ?? {}, emit, fail));
    } catch (e) {
      fail({ message: (e as Error).message || 'Native call failed', code: (e as { code?: string }).code });
    }
  }

  /** Stop one callback by its id (removeWatcher({ id })). */
  stop(id: string) { const s = this.cleanups.get(id); s?.(); this.cleanups.delete(id); }
}
