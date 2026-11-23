/**
 * Inside the app, the page's own `navigator.geolocation` makes iOS ask AGAIN, for the website, even though the person already gave
 * the app Always / While Using (the Route Planner's dot and Optimize route read it). This script, injected before the page runs,
 * stands in for it: the same calls are answered by the app's Geolocation plugin over the bridge (host/handlers/location.ts), which
 * uses the permission the app already holds — and the collector's newest point when it is fresh. App only; a browser is unchanged.
 */
export const FRESH_MS = 20_000;       // a position this young is the answer to "where am I" (a visit's stamp asks for 0 and gets a new read)
export const WATCH_EVERY_MS = 5_000;

export const GEOLOCATION_SHIM = `(function () {
  var cap = window.Capacitor;
  if (!cap || !cap.nativePromise || window.__esGeo) return;
  window.__esGeo = 1;
  var FRESH = ${FRESH_MS}, EVERY = ${WATCH_EVERY_MS}, watches = {}, seq = 0;
  var codeOf = function (e) {
    var m = String(e && e.message || '').toLowerCase();
    return /denied|permission|authori/.test(m) ? 1 : /timeout|timed out/.test(m) ? 3 : 2;
  };
  var fail = function (cb, e) {
    if (typeof cb !== 'function') return;
    cb({ code: codeOf(e), message: String(e && e.message || 'Location unavailable'), PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
  };
  var read = function (o) {
    o = o || {};
    return cap.nativePromise('Geolocation', 'getCurrentPosition', {
      enableHighAccuracy: !!o.enableHighAccuracy,
      timeout: o.timeout > 0 && o.timeout !== Infinity ? o.timeout : 20000,
      maximumAge: Math.max(Number(o.maximumAge) || 0, FRESH)
    });
  };
  var geo = {
    getCurrentPosition: function (ok, bad, o) {
      read(o).then(function (p) { if (typeof ok === 'function') ok(p); }, function (e) { fail(bad, e); });
    },
    watchPosition: function (ok, bad, o) {
      var id = ++seq, w = watches[id] = { on: true, t: null };
      var step = function () {
        if (!w.on) return;
        read(o).then(function (p) { if (w.on && typeof ok === 'function') ok(p); }, function (e) { if (w.on) fail(bad, e); })
          .then(function () { if (w.on) w.t = setTimeout(step, EVERY); });
      };
      step();
      return id;
    },
    clearWatch: function (id) { var w = watches[id]; if (w) { w.on = false; clearTimeout(w.t); delete watches[id]; } }
  };
  try { Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true }); } catch (e) {}
  var perms = navigator.permissions, orig = perms && perms.query ? perms.query.bind(perms) : null;
  if (perms) {
    try {
      perms.query = function (d) {
        if (d && d.name === 'geolocation') {
          return cap.nativePromise('Geolocation', 'checkPermissions', {}).then(function (r) {
            return { name: 'geolocation', state: r && r.location || 'prompt', onchange: null, addEventListener: function () {}, removeEventListener: function () {} };
          });
        }
        return orig ? orig(d) : Promise.reject(new TypeError('Unsupported permission'));
      };
    } catch (e) {}
  }
})();
true;`;
