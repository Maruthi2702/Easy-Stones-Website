import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useCustomerOptions } from '../../api/customerOptions';
import { useVisitTypes } from '../../api/typeLists';
import { formatForDateInput } from '../../utils/dateUtils';
import { recentCustomers, recentKey } from '../../utils/customerQuickSearch';
import { rankBySound } from '../../utils/soundAlike';
import { spokenIsEmpty } from '../../utils/assistantVisit';
import type { SpokenType } from '../../utils/assistantVisit';
import type { CustomerOption } from '../../utils/customerOptions';
import { useLocationReading } from '../location';
import { buildHints, cachedWords, loadWords, postTurn } from './assistantApi';
import {
  assistantReducer, canSave, formPrefill, initialState, saveValues, wantsMic
} from './assistantMachine';
import type { AssistantState, Candidate, EditableField, FormPrefill, RankLite } from './assistantMachine';
import { defaultSpeech } from './speechDriver';
import type { ListeningHandle, SpeechDriver } from './speechDriver';

/**
 * Everything the assistant needs from the page that mounts it. The page owns the visit save (useVisitEditor's
 * `handleSaveVisit`), so the assistant never has a second way to write a visit: `saveVisit` is that same function and answers
 * whether it saved, with the id the visit was saved under.
 */
export type AssistantHost = {
  userId: string | null;
  saveVisit: (values: Record<string, unknown>) => Promise<{ ok: boolean; visitId: string; customerId: string }>;
  /** Deletes the visit just saved (Undo) and takes it off the screen; true when it is gone. */
  undoVisit: (visitId: string, customerId: string) => Promise<boolean>;
  /** The ordinary Add visit form, opened with what was understood and the person's own words in Notes. */
  openForm: (prefill: FormPrefill) => void;
  /** "Add customer" when the search finds nobody; absent without Add customer. */
  addCustomer?: (name: string) => void;
};

/** After the person stops talking for this long (with something said) the turn is sent. */
export const SILENCE_MS = 1800;
/** How long the "Saved" bar stays once Undo is over. */
export const SAVED_LINGER_MS = 3000;

const denied = (code: unknown): boolean => /denied|not.?allowed|permission|authori[sz]/i.test(String(code ?? ''));
const toCandidate = (o: Pick<CustomerOption, 'value' | 'label' | 'city'> & Partial<Pick<CustomerOption, 'location' | 'salesRepName'>>): Candidate => {
  const note = [o.location, o.salesRepName ? `${o.salesRepName}’s customer` : ''].filter(Boolean).join(' · ');
  return { id: String(o.value), label: o.label, city: o.city || '', ...(note ? { note } : {}) };
};

const readRecent = (userId: string | null): string[] => {
  try {
    const ids = JSON.parse(window.localStorage.getItem(recentKey(userId)) || '[]');
    return Array.isArray(ids) ? ids.map(String) : [];
  } catch { return []; }
};

export function useAssistant(host: AssistantHost, speech: SpeechDriver = defaultSpeech, now: () => number = Date.now) {
  const [state, dispatch] = useReducer(assistantReducer, initialState);
  const stateRef = useRef<AssistantState>(state);
  stateRef.current = state;
  const hostRef = useRef(host);
  hostRef.current = host;

  const { options: customerOptions } = useCustomerOptions();
  const optionsRef = useRef(customerOptions);
  optionsRef.current = customerOptions;
  const visitTypes = useVisitTypes();
  const shownTypes = useMemo(() => visitTypes.active as SpokenType[], [visitTypes.active]);
  const typesRef = useRef(shownTypes);
  typesRef.current = shownTypes;

  // The visit's location: looking from the moment the sheet opens until it closes (the confirm card shows it; Save waits for it).
  const sheetOpen = state.phase !== 'idle' && state.phase !== 'saved';
  const location = useLocationReading(sheetOpen);
  const locationRef = useRef(location);
  locationRef.current = location;

  // The voice level (0..1) for the logo's pulse. A ref, not state: it changes every few milliseconds and must not re-render.
  const levelRef = useRef(0);
  const handleRef = useRef<ListeningHandle | null>(null);
  const finishRef = useRef<() => void>(() => {});
  const recentNamesRef = useRef<string[]>([]);
  // The last customers this rep opened on this device (Find a customer's list): chips when a name isn't caught, hints for the recognizer.
  const recent = useMemo<Candidate[]>(
    () => recentCustomers(customerOptions, readRecent(host.userId)).map(toCandidate),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read when the list or the person changes; `state.phase` so a fresh open sees the latest opens
    [customerOptions, host.userId, state.phase === 'idle']
  );

  // ── Opening ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const open = useCallback(async () => {
    if (stateRef.current.phase !== 'idle') return;
    const availability = await speech.availability();
    recentNamesRef.current = recentCustomers(optionsRef.current, readRecent(hostRef.current.userId)).map((o) => o.label);
    void loadWords();
    dispatch({
      type: 'OPEN', today: formatForDateInput(new Date()), types: typesRef.current,
      available: availability.available, permission: availability.permission
    });
  }, [speech]);
  const close = useCallback(() => dispatch({ type: 'CANCEL' }), []);

  const requestPermission = useCallback(async () => {
    const result = await speech.requestPermission();
    dispatch({ type: 'PERMISSION_RESULT', granted: result.granted });
  }, [speech]);

  // ── The microphone: open while the first sentence or a question is waiting for an answer ────────────────────────────────────────
  const micKey = wantsMic(state) ? `${state.phase}:${state.asking ?? ''}:${state.retries}:${state.turns}` : '';
  useEffect(() => {
    if (!micKey) return undefined;
    let cancelled = false;
    let stopped = false;
    let handle: ListeningHandle | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe: Array<() => void> = [];

    finishRef.current = () => {
      if (cancelled || stopped) return;
      stopped = true;
      clearTimeout(timer);
      void (async () => {
        let heard = '';
        try { heard = handle ? (await handle.stop()).text : ''; } catch { /* use the live words */ }
        if (cancelled) return;
        dispatch({ type: 'DONE', text: String(heard || stateRef.current.partial || '').trim() });
      })();
    };

    void (async () => {
      try {
        const opened = await speech.listen({ hints: buildHints(cachedWords(), recentNamesRef.current) });
        if (cancelled) { void opened.abort().catch(() => {}); return; }
        handle = opened;
        handleRef.current = opened;
        unsubscribe.push(
          opened.onPartial((text) => {
            if (cancelled || stopped) return;
            dispatch({ type: 'PARTIAL', text });
            clearTimeout(timer);
            // The person went quiet after saying something: that's the end of the sentence.
            if (text.trim()) timer = setTimeout(() => finishRef.current(), SILENCE_MS);
          }),
          opened.onLevel((level) => { levelRef.current = Math.max(0, Math.min(1, level)); }),
          opened.onError((e) => {
            if (cancelled || stopped) return;
            const isDenied = denied(e?.code) || denied(e?.message);
            // 'ended' / 'auto-stopped' mean the phone stopped listening BY ITSELF: the words heard so far are still there (stop() has them), so
            // they are the answer — never "didn't catch that". Any other error after words were heard keeps those words too.
            if (!isDenied && (e?.code === 'ended' || e?.code === 'auto-stopped' || stateRef.current.partial.trim())) { finishRef.current(); return; }
            dispatch({ type: 'MIC_FAILED', denied: isDenied, code: String(e?.code ?? '') });
          })
        );
        dispatch({ type: 'MIC', on: true });
      } catch (error) {
        if (!cancelled) dispatch({ type: 'MIC_FAILED', denied: denied((error as { code?: unknown })?.code) || denied((error as Error)?.message), code: String((error as { code?: unknown })?.code ?? (error as Error)?.message ?? 'start-failed').slice(0, 60) });
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe.forEach((off) => off());
      levelRef.current = 0;
      if (handleRef.current === handle) handleRef.current = null;
      if (handle && !stopped) void handle.abort().catch(() => {});
    };
  }, [micKey, speech]);

  const doneTalking = useCallback(() => finishRef.current(), []);

  // ── The turn: the words go to the server, the answer comes back as a draft ───────────────────────────────────────────────────────
  const turnRef = useRef(0);
  const thinkingTurn = state.phase === 'thinking' ? state.turns : 0;
  useEffect(() => {
    if (!thinkingTurn) return undefined;
    const id = ++turnRef.current;
    const controller = new AbortController();
    const s = stateRef.current;
    const sendDraft = !(spokenIsEmpty(s.draft) && !s.asking);
    void postTurn({ text: s.heard, today: s.today, ...(sendDraft ? { draft: s.draft } : {}), asking: s.asking }, controller.signal).then((result) => {
      if (turnRef.current !== id || controller.signal.aborted) return;
      if (!result.ok) { dispatch({ type: 'TURN_FAILED', why: result.reason }); return; }
      // Code picks the customer: the spoken name is ranked against the shared list, by sound as well as spelling.
      let rank: RankLite | null = null;
      if (!stateRef.current.customer && result.draft.customerQuery) {
        const ranked = rankBySound(optionsRef.current, result.draft.customerQuery, result.draft.cityHint);
        rank = { verdict: ranked.verdict, candidates: ranked.candidates.map((m) => toCandidate(m.option)) };
      }
      dispatch({ type: 'TURN_OK', draft: result.draft, rank });
    });
    return () => { controller.abort(); turnRef.current += 1; };
  }, [thinkingTurn]);

  // ── Saving, and the ten seconds to undo it ───────────────────────────────────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    const s = stateRef.current;
    const loc = locationRef.current;
    if (!canSave(s, loc.status === 'ready' && Boolean(loc.reading))) return;
    const values = saveValues(s, loc.reading);
    dispatch({ type: 'SAVE', ready: true });
    try {
      const result = await hostRef.current.saveVisit(values);
      dispatch(result.ok ? { type: 'SAVE_OK', visitId: result.visitId, customerId: result.customerId, now: now() } : { type: 'SAVE_FAILED' });
    } catch {
      dispatch({ type: 'SAVE_FAILED' });
    }
  }, [now]);

  const undo = useCallback(async () => {
    const saved = stateRef.current.saved;
    if (!saved || stateRef.current.undo !== 'ready') return;
    dispatch({ type: 'UNDO' });
    let ok = false;
    try { ok = await hostRef.current.undoVisit(saved.visitId, saved.customerId); } catch { ok = false; }
    dispatch({ type: ok ? 'UNDO_OK' : 'UNDO_FAILED' });
  }, []);

  const savedKey = state.phase === 'saved' ? `${state.saved?.visitId}:${state.undo}` : '';
  useEffect(() => {
    if (state.phase !== 'saved' || !state.saved) return undefined;
    if (state.undo === 'ready') {
      const timer = setTimeout(() => dispatch({ type: 'UNDO_EXPIRED' }), Math.max(0, state.saved.undoUntil - now()));
      return () => clearTimeout(timer);
    }
    if (state.undo === 'expired' || state.undo === 'failed') {
      const timer = setTimeout(() => dispatch({ type: 'CANCEL' }), state.undo === 'failed' ? 2 * SAVED_LINGER_MS : SAVED_LINGER_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- savedKey names exactly what the timers depend on
  }, [savedKey]);

  // ── The ladder's last rung: the ordinary form, with the words ────────────────────────────────────────────────────────────────────
  const openForm = useCallback(() => {
    hostRef.current.openForm(formPrefill(stateRef.current));
    dispatch({ type: 'CANCEL' });
  }, []);
  const addCustomer = useCallback((name: string) => {
    hostRef.current.addCustomer?.(name);
    dispatch({ type: 'CANCEL' });
  }, []);

  return {
    state,
    location,
    levelRef,
    types: shownTypes,
    typesLoaded: visitTypes.loaded,
    customerOptions,
    recent,
    canAddCustomer: Boolean(host.addCustomer),
    open, close, requestPermission, doneTalking, save, undo, openForm, addCustomer,
    typeInstead: useCallback(() => dispatch({ type: 'TYPE_INSTEAD' }), []),
    submitTyped: useCallback((text: string) => dispatch({ type: 'SUBMIT_TYPED', text }), []),
    back: useCallback(() => dispatch({ type: 'BACK' }), []),
    openSearch: useCallback(() => dispatch({ type: 'OPEN_SEARCH' }), []),
    pickCustomer: useCallback((customer: Candidate) => dispatch({ type: 'PICK_CUSTOMER', customer }), []),
    pickType: useCallback((name: string) => dispatch({ type: 'PICK_TYPE', name }), []),
    edit: useCallback((field: EditableField, value: string) => dispatch({ type: 'EDIT', field, value }), []),
    skip: useCallback(() => dispatch({ type: 'SKIP' }), []),
    retry: useCallback(() => dispatch({ type: 'RETRY' }), []),
    addAnother: useCallback(() => dispatch({ type: 'ADD_ANOTHER', today: formatForDateInput(new Date()) }), [])
  };
}

export type Assistant = ReturnType<typeof useAssistant>;
