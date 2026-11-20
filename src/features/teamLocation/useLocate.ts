import { useCallback, useEffect, useRef, useState } from 'react';
import { askLocate, loadLocate, loadLocateLog } from './teamLocationApi';
import type { LocateRequest } from './types';

/** How often an open ask is checked for an answer. */
export const POLL_MS = 4 * 1000;

/**
 * "Locate now" for the picked person: the reason dialog, the ask, the answer (checked every few
 * seconds while it is open) and that person's log of asks. An ask belongs to the person it was
 * made about: picking someone else drops it from the screen, never from the log.
 */
export default function useLocate(personId: string, allowed: boolean) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState<LocateRequest | null>(null);
  const [log, setLog] = useState<LocateRequest[]>([]);
  const run = useRef(0);

  const refreshLog = useCallback(async () => {
    const mine = ++run.current;
    if (!allowed || !personId) { setLog([]); return; }
    try { const { requests } = await loadLocateLog(personId); if (mine === run.current) setLog(requests); }
    catch { if (mine === run.current) setLog([]); }
  }, [allowed, personId]);

  useEffect(() => { setCurrent(null); setError(''); void refreshLog(); }, [refreshLog]);

  // While an ask is open, look for the answer.
  useEffect(() => {
    if (!current || current.status !== 'pending') return undefined;
    const id = current.id;
    const timer = setInterval(() => {
      loadLocate(id).then(({ request }) => {
        setCurrent((cur) => (cur && cur.id === id ? request : cur));
        if (request.status !== 'pending') void refreshLog();
      }).catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [current, refreshLog]);

  const ask = useCallback(async (reason: string) => {
    setSending(true); setError('');
    try {
      const { request } = await askLocate(personId, reason);
      setCurrent(request); setOpen(false); void refreshLog();
    } catch (e) { setError((e as Error).message); }
    finally { setSending(false); }
  }, [personId, refreshLog]);

  return { open, setOpen, sending, error, ask, current, log, closeDialog: () => { setOpen(false); setError(''); } };
}
