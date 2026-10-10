import { useEffect, useState } from 'react';

/**
 * Which hold is open on the Holds page lives in the URL (?tab=holds&hold=<id>),
 * so a hold can be linked to and the browser's Back button closes it. The cart
 * toast's "Open hold" goes through openHoldLink, which also reaches a Holds
 * page that is already on screen.
 */
const PARAM = 'hold';
const EVENT = 'holds:open';

const readHoldParam = () => {
  try { return new URLSearchParams(window.location.search).get(PARAM) || ''; } catch { return ''; }
};

function writeHoldParam(id, { replace = false } = {}) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(PARAM, id); else url.searchParams.delete(PARAM);
  window.history[replace ? 'replaceState' : 'pushState']({ ...(window.history.state || {}), hold: id || null }, '', url);
}

/** Open a hold from anywhere — call after switching to the Holds tab. */
export function openHoldLink(id) {
  writeHoldParam(id, { replace: true });
  window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
}

/** [open hold id ('' for the list), open(id), close()] */
export function useHoldLink() {
  const [id, setId] = useState(readHoldParam);
  useEffect(() => {
    const sync = () => setId(readHoldParam());
    window.addEventListener('popstate', sync);
    window.addEventListener(EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(EVENT, sync);
    };
  }, []);
  const open = (next) => { writeHoldParam(next); setId(next); };
  const close = () => { writeHoldParam(''); setId(''); };
  return [id, open, close];
}
