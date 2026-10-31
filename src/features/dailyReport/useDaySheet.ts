import { useState, useEffect, useCallback, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { withAllPaymentMethods } from '../../utils/dailyReportPayments';
import { buildSaveBody } from './savePayload';
import { ALL, emptyReport } from './reportFigures';
import { useFlushOnPageHide } from './useFlushOnPageHide';
import type { Report, ShippedEarlierGroup, SlabRange } from './types';

/** What a save refused because the day was locked under it (409) says. */
const SUBMITTED_NOTICE = 'This day has been submitted. Reopen it to make more changes.';

export type DaySheetOptions = {
  date: string;
  /** The branch on screen, or ALL (nothing to load: the every-branch reading). */
  location: string;
  view: string;
  canEdit: boolean;
  /** The page's one error line, shared with the branch list's load. */
  setError: Dispatch<SetStateAction<string | null>>;
};

/**
 * One branch's day: loading it, autosaving the draft, and submitting it.
 *
 * The rules here are the ones the 2026-08-28 incident and O12–O14
 * (KNOWN_ISSUES.md) were about — every save is a draft save (buildSaveBody),
 * figures typed on an earlier visit count as touched (handSet), a change
 * waiting for the autosave is sent rather than dropped when the day, branch or
 * view changes or the sheet closes, Submit stops when its own save fails, and
 * an answer for a day no longer on screen is ignored. Pinned by
 * useDaySheet.test.tsx and DailyReportTab.behaviour.test.tsx.
 */
export function useDaySheet({ date, location, view, canEdit, setError }: DaySheetOptions) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [dirty, setDirty] = useState(false);
  // What a slab count usually looks like for this branch — the server works it
  // out so the rule isn't reinvented here.
  const [slabRange, setSlabRange] = useState<SlabRange | null>(null);
  // Transfers the delivery board draws on this day that shipped in an earlier
  // week — see transfersShippedEarlier in src/routes/dailyReports.ts.
  const [shippedEarlier, setShippedEarlier] = useState<ShippedEarlierGroup[]>([]);
  // The day's tickets with no branch — counted on no report (NoBranchNote).
  const [noBranchTickets, setNoBranchTickets] = useState(0);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const skipAutosave = useRef(true);
  // The promise of whatever save() call is currently in flight, so submitDay
  // can wait for it to actually land before its own save and the submit.
  // Clearing the debounce timer only stops a save that hasn't fired yet — one
  // already on the wire could otherwise arrive after the submit and be
  // refused (409), or be the one the server re-derives on instead of the
  // last edit.
  const pendingSave = useRef<Promise<boolean> | null>(null);
  // Which of the system-derived slab figures this person has actually typed
  // into this session, as opposed to ones just sitting on screen because
  // deriveFromSystem filled them in. Reset on every load. Without this,
  // autosaving an unrelated edit (a visitor count, a payment) would write the
  // whole report — capacity and transfer slabs included — and freeze them at
  // whatever they happened to be at that moment, so a delivery added later in
  // the day would never make it into the total. See buildSaveBody (savePayload.ts).
  const touchedCapacity = useRef(new Set<string>());   // 'deliveries' | 'pickups'
  const touchedTransferSlabs = useRef(new Set<string>()); // transferLineKey(line): direction, route and which transfer

  // ── load the day ──────────────────────────────────────────────────────────
  // Each load is numbered. On slow data, tapping Next day twice could have the
  // first day's answer arrive last and replace the second's — the header said
  // one day while the figures (and every save, and Submit) were another.
  // A response for a load that's no longer the latest is dropped.
  // `notice`: the message to show while and after it loads, instead of
  // clearing it — the reload after a save refused as submitted keeps saying
  // why the sheet is now locked.
  const loadSeq = useRef(0);
  const loadDay = useCallback(async (notice: string | null = null) => {
    // "All locations" is a reading of the day, not a sheet to fill in — it
    // fetches every branch itself rather than one report to edit.
    if (!location || location === ALL) return;
    const seq = ++loadSeq.current;
    const current = () => seq === loadSeq.current;
    setLoading(true);
    setError(notice);
    try {
      const tzOffset = -new Date().getTimezoneOffset();
      const res = await authFetch(
        `${API_URL}/api/daily-reports/${date}?location=${encodeURIComponent(location)}&tzOffset=${tzOffset}`
      );
      if (!res.ok) throw new Error((await res.json()).message || 'Could not load that day.');
      const data = await res.json();
      if (!current()) return;
      skipAutosave.current = true;
      // Figures someone typed on an earlier visit count as touched, so this
      // visit's saves — and the one before Submit — keep them instead of
      // blanking them for the schedule to refill (handSetFigures on the server).
      touchedCapacity.current = new Set<string>(data.handSet?.capacity || []);
      touchedTransferSlabs.current = new Set<string>(data.handSet?.transferSlabs || []);
      // A report saved before ACH existed has no payments.ach — fill the
      // blank in so the row renders instead of throwing.
      setReport({
        ...emptyReport(date, location),
        ...data.report,
        payments: withAllPaymentMethods(data.report?.payments)
      });
      setSlabRange(data.slabRange || null);
      setShippedEarlier(data.transfersShippedEarlier || []);
      setNoBranchTickets(data.derived?.noBranchTickets || 0);
      setDirty(false);
    } catch (err) {
      if (!current()) return;
      setError((err as Error).message);
      setReport(null);
      setShippedEarlier([]);
      setNoBranchTickets(0);
    } finally {
      if (current()) setLoading(false);
    }
  }, [date, location, setError]);

  useEffect(() => { if (view === 'day') loadDay(); }, [loadDay, view]);

  // Held in a ref so reloading after a lock doesn't change save's identity —
  // the autosave effect depends on it, and a new save on every date change
  // would schedule a write nobody asked for.
  const loadDayRef = useRef(loadDay);
  useEffect(() => { loadDayRef.current = loadDay; }, [loadDay]);

  // ── autosave the draft ────────────────────────────────────────────────────
  // Resolves true once the server has the figures, false if it doesn't — so
  // Submit can refuse to lock a day whose last save didn't land.
  // `leaving`: the save of a day the person has just moved off (see
  // flushPendingSave) — a failure names that day instead of disturbing the
  // one now on screen. `keepalive`: the page itself is going away (tab
  // closed, app switched); the browser finishes a keepalive request after the
  // page is gone, where an ordinary one is usually dropped.
  const savesInFlight = useRef(0);
  const save = useCallback((payload: Report, { leaving = false, keepalive = false }: { leaving?: boolean; keepalive?: boolean } = {}): Promise<boolean> => {
    if (!canEdit || payload.status === 'submitted') return Promise.resolve(false);
    if (!leaving) setSaving(true);
    savesInFlight.current += 1;
    const run = (async () => {
      try {
        const res = await authFetch(`${API_URL}/api/daily-reports/${payload.date}`, {
          method: 'PUT',
          keepalive,
          body: JSON.stringify(buildSaveBody(payload, {
            touchedCapacity: touchedCapacity.current,
            touchedTransferSlabs: touchedTransferSlabs.current
          }))
        });
        // 409 means the day was locked under us — someone else submitted it, or
        // the clock reached 11:59 while this form was still open. Show it as it
        // now is rather than leaving edits going into a sheet that won't take
        // them.
        if (res.status === 409) {
          if (leaving) {
            setError(`Your last change to ${payload.date} wasn't saved — that day had been submitted. Reopen it to change it.`);
          } else {
            setError(SUBMITTED_NOTICE);
            setDirty(false);
            loadDayRef.current?.(SUBMITTED_NOTICE);
          }
          return false;
        }
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Could not save.');
        if (!leaving) {
          setSavedAt(new Date());
          setDirty(false);
          setError(null);
        }
        return true;
      } catch (err) {
        setError(leaving
          ? `Your last change to ${payload.date} wasn't saved (${(err as Error).message}). Open that day and check it.`
          : (err as Error).message);
        return false;
      } finally {
        savesInFlight.current -= 1;
        if (!leaving) setSaving(false);
      }
    })();
    pendingSave.current = run;
    return run;
  }, [canEdit, setError]);

  // The edits still waiting for the 1.2-second autosave. Moving to another
  // day, branch or view (or leaving the tab) used to cancel that timer and
  // throw them away; now they're sent straight away instead. Kept in a ref so
  // the autosave effect's own cleanup — which runs on every keystroke — never
  // clears it.
  const pendingPayload = useRef<Report | null>(null);
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);
  const flushPendingSave = useCallback(({ keepalive = false }: { keepalive?: boolean } = {}) => {
    const payload = pendingPayload.current;
    if (!payload) return;
    pendingPayload.current = null;
    clearTimeout(saveTimer.current);
    saveRef.current(payload, { leaving: true, keepalive });
  }, []);
  // Before another day, branch or view loads (cleanups run before the next
  // load starts), and when the sheet unmounts (another part of the app).
  useEffect(() => () => flushPendingSave(), [date, location, view, flushPendingSave]);

  // The browser tab closing, reloading, or the phone switching apps.
  useFlushOnPageHide(flushPendingSave, pendingPayload, savesInFlight);

  useEffect(() => {
    if (!report || !canEdit || report.status === 'submitted') return;
    if (skipAutosave.current) { skipAutosave.current = false; return; }
    setDirty(true);
    clearTimeout(saveTimer.current);
    pendingPayload.current = report;
    saveTimer.current = setTimeout(() => {
      pendingPayload.current = null;
      save(report);
    }, 1200);
    return () => clearTimeout(saveTimer.current);
  }, [report, canEdit, save]);

  const submitDay = async () => {
    clearTimeout(saveTimer.current);
    // This save covers whatever was waiting for the autosave.
    pendingPayload.current = null;
    // An autosave PUT may already be on the wire — cancelling the timer only
    // stops one that hasn't fired yet. Wait for it to land first.
    if (pendingSave.current) await pendingSave.current.catch(() => {});
    // An ordinary draft save, not what this page loaded: /submit re-derives
    // the system's figures as of now before it locks the day (applyDerived),
    // keeping only what someone typed — so a sheet left open since the
    // morning still signs off tonight's check-ins and tickets.
    // If that save didn't land, stop: locking now would sign off the older
    // figures the server has, and lose what's on screen for good.
    const saved = await save(report as Report);
    if (!saved) {
      // save() already said why; a 409 ("has been submitted") needs nothing added.
      setError((e) => (e === SUBMITTED_NOTICE
        ? e
        : `Couldn’t save your last changes, so the day wasn’t submitted${e ? ` (${e})` : ''}. Check your connection and try again.`));
      return;
    }
    // The day whose figures these are — the report's own date and branch,
    // not the header's, should the two ever disagree.
    const res = await authFetch(`${API_URL}/api/daily-reports/${(report as Report).date}/submit`, {
      method: 'POST',
      body: JSON.stringify({ location: (report as Report).location })
    });
    if (res.ok) { loadDay(); return; }
    const message = (await res.json().catch(() => ({}))).message || 'Could not submit this day.';
    // 409: someone else (or the 11:59 auto-submit) signed it off first —
    // show the locked day they submitted, with the note why.
    if (res.status === 409) await loadDay();
    setError(message);
  };

  // A slab figure typed by hand: kept in every save from now on.
  const touchCapacity = (key: string) => { touchedCapacity.current.add(key); };
  const touchTransferSlabs = (key: string) => { touchedTransferSlabs.current.add(key); };

  return {
    report, setReport, loading, saving, savedAt, dirty, slabRange, shippedEarlier, noBranchTickets,
    loadDay, submitDay, touchCapacity, touchTransferSlabs
  };
}

export type DaySheet = ReturnType<typeof useDaySheet>;
