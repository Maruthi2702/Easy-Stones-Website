/**
 * The bridge between the website (running in a WebView) and the phone. The website is the SAME code the Capacitor app ran: it calls
 * `@capacitor/core` plugins (App, Keyboard, PushNotifications, Geolocation, BackgroundGeolocation, LocationHealth). Capacitor's JS
 * lets a host stand in for its native side: it reads `window.CapacitorCustomPlatform`, `window.Capacitor.PluginHeaders` and calls
 * `Capacitor.nativePromise / nativeCallback`. `shimFor` builds the script that defines those and relays each call to this React
 * Native app over `postMessage`; `router.ts` answers them. No change to the website was needed.
 */
export type PluginImpl = {
  /** Promise methods: resolve with the plugin's answer. */
  calls: Record<string, (options: any) => unknown>;
  /** Callback methods (addWatcher…): given an emitter; return a function that stops them. */
  callbacks: Record<string, (options: any, emit: Emit, fail: Fail) => Promise<() => void> | (() => void)>;
  /** Events for addListener(eventName): given an emitter; return a function that stops them. */
  events: Record<string, (emit: Emit) => (() => void) | Promise<() => void>>;
};
export type Emit = (data: unknown) => void;
export type Fail = (error: { message: string; code?: string }) => void;
export type Plugins = Record<string, PluginImpl>;

export type PluginHeader = { name: string; methods: { name: string; rtype: 'promise' | 'callback' }[] };

export function headersFor(plugins: Plugins): PluginHeader[] {
  return Object.entries(plugins).map(([name, p]) => ({
    name,
    methods: [
      ...Object.keys(p.calls).map((m) => ({ name: m, rtype: 'promise' as const })),
      ...Object.keys(p.callbacks).map((m) => ({ name: m, rtype: 'callback' as const })),
      ...(Object.keys(p.events).length ? [{ name: 'addListener', rtype: 'callback' as const }, { name: 'removeListener', rtype: 'promise' as const }] : []),
      { name: 'removeAllListeners', rtype: 'promise' as const }
    ]
  }));
}

/** The script injected BEFORE the page's own code runs. */
export function shimFor(platform: 'ios' | 'android', plugins: Plugins): string {
  const headers = JSON.stringify(headersFor(plugins));
  return `(function () {
  var seq = 0, pending = {}, listeners = {};
  var post = function (m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  var cap = window.Capacitor = window.Capacitor || {};
  window.CapacitorCustomPlatform = { name: ${JSON.stringify(platform)} };
  window.__EASY_HOST__ = 'react-native';
  cap.PluginHeaders = ${headers};
  cap.nativePromise = function (plugin, method, options) {
    return new Promise(function (resolve, reject) {
      var id = 'p' + (++seq);
      pending[id] = { resolve: resolve, reject: reject };
      post({ t: 'call', id: id, plugin: plugin, method: method, options: options || {} });
    });
  };
  cap.nativeCallback = function (plugin, method, options, callback) {
    var id = 'c' + (++seq);
    listeners[id] = callback;
    post({ t: 'callback', id: id, plugin: plugin, method: method, options: options || {} });
    return id;
  };
  window.__easyHostReply = function (m) {
    if (m.t === 'result') {
      var p = pending[m.id]; if (!p) return; delete pending[m.id];
      if (m.ok) p.resolve(m.data);
      else { var e = new Error(m.error && m.error.message || 'Native call failed'); e.code = m.error && m.error.code; p.reject(e); }
    } else if (m.t === 'event') {
      var l = listeners[m.id]; if (!l) return;
      if (m.error) l(undefined, m.error); else l(m.data);
    } else if (m.t === 'drop') { delete listeners[m.id]; }
  };
})();
true;`;
}
