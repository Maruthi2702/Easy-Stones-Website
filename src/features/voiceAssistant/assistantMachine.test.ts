import { describe, expect, it } from 'vitest';
import { EMPTY_SPOKEN_VISIT } from '../../utils/assistantVisit';
import type { SpokenType, SpokenVisit } from '../../utils/assistantVisit';
import {
  assistantReducer, canRetry, canSave, confirmRows, formPrefill, initialState, isSkipWords, isSpinning, MAX_RETRIES, mustOpenForm,
  questionText, saveValues, typeChoices, undoLeftMs, UNDO_WINDOW_MS, wantsMic
} from './assistantMachine';
import type { AssistantEvent, AssistantState, Candidate, Phase } from './assistantMachine';

const TYPES: SpokenType[] = [
  { name: 'Unscheduled in Person Sales Call', label: 'Unscheduled sales call', active: true, fields: { notes: true, outcome: true, followUp: 'optional' } },
  { name: 'Scheduled in Person Sales Meeting', label: 'Scheduled sales meeting', active: true, fields: { notes: true, outcome: true, followUp: 'optional' } },
  { name: 'Resource Placement', label: 'Resource placement', active: true, fields: { notes: true, outcome: false, followUp: 'none' } },
  { name: 'Formal Presentation', label: 'Formal presentation', active: true, fields: { notes: true, outcome: true, followUp: 'always' } },
  { name: 'Remote Call', label: 'Remote meeting / call', active: true, fields: { notes: false, outcome: false, followUp: 'none' } },
  { name: 'Hidden Type', label: 'Hidden', active: false }
];
const KENT: Candidate = { id: 'c1', label: 'Smith Granite', city: 'Kent' };
const TACOMA: Candidate = { id: 'c2', label: 'Smith Granite', city: 'Tacoma' };
const draft = (patch: Partial<SpokenVisit> = {}): SpokenVisit => ({ ...EMPTY_SPOKEN_VISIT, ...patch });
const TODAY = '2026-11-28';

const run = (events: AssistantEvent[], from: AssistantState = initialState) => events.reduce(assistantReducer, from);
const open = (permission: 'granted' | 'denied' | 'undetermined' = 'granted', available = true): AssistantEvent =>
  ({ type: 'OPEN', today: TODAY, types: TYPES, available, permission });
const clear = (c: Candidate = KENT) => ({ verdict: 'clear' as const, candidates: [c] });

/** Gets to "thinking" after one spoken sentence. */
const thinking = (sentence = 'Log a visit at Smith Granite') => run([open(), { type: 'DONE', text: sentence }]);
/** A complete visit on the confirm card. */
const confirm = () => run([
  { type: 'TURN_OK', draft: draft({ customerQuery: 'Smith Granite', visitType: TYPES[0].name, notes: 'Dropped samples', outcome: 'Wants a quote' }), rank: clear() }
], thinking());

describe('opening', () => {
  it('opens listening when the microphone is already allowed', () => {
    const s = run([open()]);
    expect(s.phase).toBe('listening');
    expect(s.today).toBe(TODAY);
    expect(s.types).toBe(TYPES);
    expect(wantsMic(s)).toBe(true);
  });
  it('asks for permission first when the phone has not been asked', () => {
    const s = run([open('undetermined')]);
    expect(s.phase).toBe('permission');
    expect(run([{ type: 'PERMISSION_RESULT', granted: true }], s).phase).toBe('listening');
    const denied = run([{ type: 'PERMISSION_RESULT', granted: false }], s);
    expect(denied.phase).toBe('error');
    expect(denied.error).toEqual({ kind: 'permission-denied' });
  });
  it('says so when the microphone is already turned off', () => {
    const s = run([open('denied')]);
    expect(s.phase).toBe('error');
    expect(s.error?.kind).toBe('permission-denied');
    expect(mustOpenForm(s)).toBe(false);
  });
  it('has nothing to offer without the plugin: the ordinary form is the way', () => {
    const s = run([open('granted', false)]);
    expect(s.phase).toBe('error');
    expect(s.error).toEqual({ kind: 'turn-failed', why: 'unavailable' });
    expect(mustOpenForm(s)).toBe(true);
  });
  it('ignores a second OPEN while it is already open', () => {
    const s = run([open()]);
    expect(assistantReducer(s, open('denied'))).toBe(s);
  });
});

describe('listening and thinking', () => {
  it('shows the live words, then sends them when the person is done', () => {
    let s = run([open(), { type: 'MIC', on: true }, { type: 'PARTIAL', text: 'log a visit at smith' }]);
    expect(s.partial).toBe('log a visit at smith');
    expect(s.mic).toBe('on');
    s = run([{ type: 'DONE', text: 'log a visit at smith granite' }], s);
    expect(s.phase).toBe('thinking');
    expect(s.heard).toBe('log a visit at smith granite');
    expect(s.said).toEqual(['log a visit at smith granite']);
    expect(s.partial).toBe('');
    expect(s.turns).toBe(1);
    expect(isSpinning(s)).toBe(true);
    expect(wantsMic(s)).toBe(false);
  });
  it('spins only while hearing or working', () => {
    expect(isSpinning(initialState)).toBe(false);
    expect(isSpinning(run([open()]))).toBe(true);
    expect(isSpinning(confirm())).toBe(false);
  });
  it('ignores words that arrive in another state', () => {
    const s = confirm();
    expect(assistantReducer(s, { type: 'PARTIAL', text: 'x' })).toBe(s);
    expect(assistantReducer(s, { type: 'DONE', text: 'x' })).toBe(s);
  });
});

describe('the recognizer failing', () => {
  it('a refused permission shows the steps to turn it on', () => {
    const s = run([open(), { type: 'MIC', on: true }, { type: 'MIC_FAILED', denied: true }]);
    expect(s.phase).toBe('error');
    expect(s.error).toEqual({ kind: 'permission-denied' });
    expect(s.mic).toBe('off');
  });
  it('any other failure is "didn\'t catch that" with a retry', () => {
    const s = run([open(), { type: 'MIC_FAILED', denied: false }]);
    expect(s.error).toEqual({ kind: 'nothing-heard' });
    expect(canRetry(s)).toBe(true);
  });
  it('is ignored when nothing is listening', () => {
    const s = confirm();
    expect(assistantReducer(s, { type: 'MIC_FAILED', denied: true })).toBe(s);
  });
});

describe('what comes back', () => {
  it('a clear customer and a complete visit go straight to the confirm card', () => {
    const s = confirm();
    expect(s.phase).toBe('confirm');
    expect(s.customer).toEqual(KENT);
    expect(s.asking).toBeNull();
    expect(canSave(s, true)).toBe(true);
    expect(canSave(s, false)).toBe(false);
  });
  it('two customers that sound alike ask "Which one?"', () => {
    const s = run([{ type: 'TURN_OK', draft: draft({ customerQuery: 'Smith Granite' }), rank: { verdict: 'ambiguous', candidates: [KENT, TACOMA] } }], thinking());
    expect(s.phase).toBe('pick');
    expect(s.candidates).toEqual([KENT, TACOMA]);
    expect(s.customer).toBeNull();
    // A tap picks; the next missing piece is asked.
    const picked = run([{ type: 'PICK_CUSTOMER', customer: TACOMA }], s);
    expect(picked.customer).toEqual(TACOMA);
    expect(picked.phase).toBe('ask');
    expect(picked.asking).toBe('type');
    expect(picked.candidates).toEqual([]);
  });
  it('no customer match asks for the customer, remembering what was heard', () => {
    const s = run([{ type: 'TURN_OK', draft: draft({ customerQuery: 'smith grant it' }), rank: { verdict: 'none', candidates: [] } }], thinking());
    expect(s.phase).toBe('ask');
    expect(s.asking).toBe('customer');
    expect(s.customerMiss).toBe('smith grant it');
    expect(questionText(s)).toBe('I didn’t catch the customer');
  });
  it('no customer said at all asks "Which customer?"', () => {
    const s = run([{ type: 'TURN_OK', draft: draft({ notes: 'dropped samples' }), rank: null }], thinking());
    expect(s.asking).toBe('customer');
    expect(s.customerMiss).toBe('');
    expect(questionText(s)).toBe('Which customer?');
  });
  it('asks the visit type when it was not said, one question at a time', () => {
    const s = run([{ type: 'TURN_OK', draft: draft({ customerQuery: 'Smith Granite', notes: 'Dropped samples' }), rank: clear() }], thinking());
    expect(s.phase).toBe('ask');
    expect(s.asking).toBe('type');
    expect(questionText(s)).toBe('What kind of visit was it?');
    const next = run([{ type: 'PICK_TYPE', name: TYPES[1].name }], s);
    expect(next.draft.visitType).toBe(TYPES[1].name);
    expect(next.phase).toBe('ask');
    expect(next.asking).toBe('outcome');
  });
  it('asks notes, then outcome, then (only when the type requires it) the follow-up', () => {
    let s = run([{ type: 'TURN_OK', draft: draft({ customerQuery: 'Smith Granite', visitType: 'Formal Presentation' }), rank: clear() }], thinking());
    expect(s.asking).toBe('notes');
    s = run([{ type: 'TURN_OK', draft: { ...s.draft, notes: 'Showed slabs' }, rank: null }], run([{ type: 'DONE', text: 'showed slabs' }], s));
    expect(s.asking).toBe('outcome');
    s = run([{ type: 'TURN_OK', draft: { ...s.draft, outcome: 'Likes it' }, rank: null }], run([{ type: 'DONE', text: 'they like it' }], s));
    expect(s.asking).toBe('followUp');
    s = run([{ type: 'TURN_OK', draft: { ...s.draft, followUp: 'Send quote', followUpDate: '2026-12-04' }, rank: null }], run([{ type: 'DONE', text: 'send a quote friday' }], s));
    expect(s.phase).toBe('confirm');
  });
  it('never asks what the type does not use', () => {
    const s = run([{ type: 'TURN_OK', draft: draft({ customerQuery: 'Smith Granite', visitType: 'Remote Call' }), rank: clear() }], thinking());
    expect(s.phase).toBe('confirm');
  });
  it('an optional follow-up is not nagged for', () => {
    const s = run([{ type: 'TURN_OK', draft: draft({ customerQuery: 'x', visitType: TYPES[0].name, notes: 'n', outcome: 'o' }), rank: clear() }], thinking());
    expect(s.phase).toBe('confirm');
  });
  it('a question answered with nothing is not asked a second time', () => {
    let s = run([{ type: 'TURN_OK', draft: draft({ customerQuery: 'Smith Granite', visitType: TYPES[0].name }), rank: clear() }], thinking());
    expect(s.asking).toBe('notes');
    s = run([{ type: 'DONE', text: 'uh the thing' }], s);
    s = run([{ type: 'TURN_OK', draft: s.draft, rank: null }], s);
    expect(s.asking).toBe('outcome');
    expect(s.skipped).toContain('notes');
  });
  it('keeps what was tapped when the next answer comes back', () => {
    let s = run([{ type: 'TURN_OK', draft: draft({ customerQuery: 'Smith Granite' }), rank: clear() }], thinking());
    s = run([{ type: 'PICK_TYPE', name: TYPES[2].name }], s);
    expect(s.draft.visitType).toBe(TYPES[2].name);
    expect(s.customer).toEqual(KENT);
  });
  it('ignores an answer that arrives when nothing is waiting for one', () => {
    const s = run([open()]);
    expect(assistantReducer(s, { type: 'TURN_OK', draft: draft(), rank: null })).toBe(s);
    expect(assistantReducer(s, { type: 'TURN_FAILED', why: 'failed' })).toBe(s);
  });
});

describe('skipping and answering a question', () => {
  const asking = () => run([{ type: 'TURN_OK', draft: draft({ customerQuery: 'x', visitType: TYPES[0].name }), rank: clear() }], thinking());
  it('"skip" on the screen moves on without asking again', () => {
    const s = asking();
    expect(s.asking).toBe('notes');
    const n = run([{ type: 'SKIP' }], s);
    expect(n.asking).toBe('outcome');
    expect(n.skipped).toEqual(['notes']);
  });
  it('saying "none" skips a notes / outcome / follow-up question with no server turn', () => {
    const s = run([{ type: 'MIC', on: true }, { type: 'DONE', text: 'None.' }], asking());
    expect(s.phase).toBe('ask');
    expect(s.asking).toBe('outcome');
    expect(s.turns).toBe(1);
  });
  it('the type and the customer cannot be skipped', () => {
    const t = run([{ type: 'TURN_OK', draft: draft({ customerQuery: 'x' }), rank: clear() }], thinking());
    expect(t.asking).toBe('type');
    expect(assistantReducer(t, { type: 'SKIP' })).toBe(t);
    const c = run([{ type: 'TURN_OK', draft: draft(), rank: null }], thinking());
    expect(assistantReducer(c, { type: 'SKIP' })).toBe(c);
  });
  it('words that mean skip', () => {
    for (const w of ['skip', 'Skip it', 'none', 'None.', 'nothing', 'no', 'nope', 'no outcome', 'no thanks', 'that’s all']) expect(isSkipWords(w)).toBe(true);
    for (const w of ['', 'no problem with the install', 'nothing like the sample', 'noted the price']) expect(isSkipWords(w)).toBe(false);
  });
  it('sends an answer as a turn with the question retained', () => {
    const s = run([{ type: 'DONE', text: 'they wanted a quote' }], asking());
    expect(s.phase).toBe('thinking');
    expect(s.asking).toBe('notes');
    expect(s.said).toEqual(['Log a visit at Smith Granite', 'they wanted a quote']);
  });
});

describe('typing instead and searching', () => {
  it('typing replaces the mic and sends like a spoken turn', () => {
    let s = run([open(), { type: 'TYPE_INSTEAD' }]);
    expect(s.phase).toBe('typing');
    expect(wantsMic(s)).toBe(false);
    expect(run([{ type: 'BACK' }], s).phase).toBe('listening');
    expect(assistantReducer(s, { type: 'SUBMIT_TYPED', text: '   ' })).toBe(s);
    s = run([{ type: 'SUBMIT_TYPED', text: 'visit at Smith Granite, dropped samples' }], s);
    expect(s.phase).toBe('thinking');
    expect(s.said).toEqual(['visit at Smith Granite, dropped samples']);
  });
  it('typing works from a question, and Back returns to it', () => {
    const asking = run([{ type: 'TURN_OK', draft: draft({ customerQuery: 'x', visitType: TYPES[0].name }), rank: clear() }], thinking());
    const typing = run([{ type: 'TYPE_INSTEAD' }], asking);
    expect(typing.asking).toBe('notes');
    const back = run([{ type: 'BACK' }], typing);
    expect(back.phase).toBe('ask');
    expect(back.asking).toBe('notes');
  });
  it('typing is offered after an error and when permission is off', () => {
    const denied = run([open('denied'), { type: 'TYPE_INSTEAD' }]);
    expect(denied.phase).toBe('typing');
    expect(run([{ type: 'BACK' }], denied).phase).toBe('error');
    expect(run([{ type: 'SUBMIT_TYPED', text: 'visit at Smith' }], denied).phase).toBe('thinking');
  });
  it('searching for a customer, from "Which one?" and from a missed name, and picking from it', () => {
    const miss = run([{ type: 'TURN_OK', draft: draft({ customerQuery: 'zzz' }), rank: { verdict: 'none', candidates: [] } }], thinking());
    const search = run([{ type: 'OPEN_SEARCH' }], miss);
    expect(search.phase).toBe('search');
    expect(run([{ type: 'BACK' }], search).asking).toBe('customer');
    const picked = run([{ type: 'PICK_CUSTOMER', customer: KENT }], search);
    expect(picked.customer).toEqual(KENT);
    expect(picked.asking).toBe('type');
    const pick = run([{ type: 'TURN_OK', draft: draft({ customerQuery: 'Smith' }), rank: { verdict: 'ambiguous', candidates: [KENT, TACOMA] } }], thinking());
    expect(run([{ type: 'OPEN_SEARCH' }, { type: 'BACK' }], pick).phase).toBe('pick');
  });
  it('changing the customer from the confirm card', () => {
    const s = run([{ type: 'OPEN_SEARCH' }, { type: 'PICK_CUSTOMER', customer: TACOMA }], confirm());
    expect(s.phase).toBe('confirm');
    expect(s.customer).toEqual(TACOMA);
  });
  it('Back does nothing elsewhere', () => {
    const s = confirm();
    expect(assistantReducer(s, { type: 'BACK' })).toBe(s);
  });
});

describe('the failure ladder', () => {
  it('nothing heard: "Didn\'t catch that" with a retry, twice, then the form', () => {
    let s = run([open(), { type: 'DONE', text: '   ' }]);
    expect(s.phase).toBe('error');
    expect(s.error).toEqual({ kind: 'nothing-heard' });
    expect(canRetry(s)).toBe(true);
    s = run([{ type: 'RETRY' }], s);
    expect(s.phase).toBe('listening');
    s = run([{ type: 'DONE', text: '' }, { type: 'RETRY' }, { type: 'DONE', text: '' }], s);
    expect(s.retries).toBe(MAX_RETRIES + 1);
    expect(canRetry(s)).toBe(false);
    expect(mustOpenForm(s)).toBe(true);
    expect(assistantReducer(s, { type: 'RETRY' })).toBe(s);
  });
  it('the server saying "empty" or "unreadable" is the same "didn\'t catch that"', () => {
    for (const why of ['empty', 'unreadable'] as const) {
      const s = run([{ type: 'TURN_FAILED', why }], thinking());
      expect(s.error?.kind).toBe('nothing-heard');
      expect(canRetry(s)).toBe(true);
    }
  });
  it('a retry keeps the question being answered', () => {
    const asking = run([{ type: 'TURN_OK', draft: draft({ customerQuery: 'x', visitType: TYPES[0].name }), rank: clear() }], thinking());
    const s = run([{ type: 'DONE', text: '' }, { type: 'RETRY' }], asking);
    expect(s.phase).toBe('ask');
    expect(s.asking).toBe('notes');
  });
  it('Claude failing, busy, refusing, the limit, no signal or no key all open the form with the words', () => {
    for (const why of ['failed', 'busy', 'refused', 'limit', 'network', 'unavailable', 'forbidden'] as const) {
      const s = run([{ type: 'TURN_FAILED', why }], thinking('log a visit at Smith Granite, dropped samples'));
      expect(s.phase).toBe('error');
      expect(s.error).toEqual({ kind: 'turn-failed', why });
      expect(mustOpenForm(s)).toBe(true);
      expect(canRetry(s)).toBe(false);
      expect(formPrefill(s).notes).toBe('log a visit at Smith Granite, dropped samples');
      expect(assistantReducer(s, { type: 'RETRY' })).toBe(s);
    }
  });
  it('the form prefill keeps what was understood and every sentence the person said', () => {
    let s = run([{ type: 'TURN_OK', draft: draft({ customerQuery: 'Smith Granite', visitType: TYPES[0].name }), rank: clear() }], thinking('first sentence'));
    s = run([{ type: 'DONE', text: 'second sentence' }, { type: 'TURN_FAILED', why: 'network' }], s);
    expect(formPrefill(s)).toEqual({
      customerId: 'c1', purpose: TYPES[0].name, date: TODAY, notes: 'first sentence\nsecond sentence', outcome: '', followUp: '', followUpDate: ''
    });
    const withNotes = { ...s, draft: { ...s.draft, notes: 'Dropped samples' } };
    expect(formPrefill(withNotes).notes).toBe('Dropped samples');
  });
});

describe('the confirm card', () => {
  it('lists what will be saved, "Not mentioned" rows empty', () => {
    const rows = confirmRows(confirm(), (n) => TYPES.find((t) => t.name === n)!.label!, (d) => `day ${d}`);
    expect(rows.map((r) => [r.field, r.value, r.empty])).toEqual([
      ['customer', 'Smith Granite · Kent', false],
      ['visitType', 'Unscheduled sales call', false],
      ['visitDate', `day ${TODAY}`, false],
      ['notes', 'Dropped samples', false],
      ['outcome', 'Wants a quote', false],
      ['followUp', '', true]
    ]);
  });
  it('leaves out rows the type does not use', () => {
    const s = run([{ type: 'TURN_OK', draft: draft({ customerQuery: 'x', visitType: 'Remote Call' }), rank: clear() }], thinking());
    expect(confirmRows(s, (n) => n, (d) => d).map((r) => r.field)).toEqual(['customer', 'visitType', 'visitDate']);
  });
  it('every field can be edited; the day and follow-up included', () => {
    let s = confirm();
    s = run([
      { type: 'EDIT', field: 'notes', value: '  Showed Calacatta ' },
      { type: 'EDIT', field: 'visitDate', value: '2026-11-27' },
      { type: 'EDIT', field: 'followUp', value: 'Send quote' },
      { type: 'EDIT', field: 'followUpDate', value: '2026-12-04' }
    ], s);
    expect(s.phase).toBe('confirm');
    expect(s.draft).toMatchObject({ notes: 'Showed Calacatta', visitDate: '2026-11-27', followUp: 'Send quote', followUpDate: '2026-12-04' });
  });
  it('changing the type to one that needs more asks for it', () => {
    const s = run([{ type: 'EDIT', field: 'visitType', value: 'Formal Presentation' }], run([{ type: 'EDIT', field: 'notes', value: '' }], confirm()));
    expect(s.draft.visitType).toBe('Formal Presentation');
    expect(s.phase).toBe('ask');
    expect(s.asking).toBe('notes');
  });
  it('refuses a type that is not on the shown list', () => {
    const s = confirm();
    expect(assistantReducer(s, { type: 'EDIT', field: 'visitType', value: 'Made Up' })).toBe(s);
    expect(assistantReducer(s, { type: 'PICK_TYPE', name: 'Made Up' })).toBe(s);
  });
  it('offers the first four visit types, or all the shown ones, never a hidden type', () => {
    const s = confirm();
    expect(typeChoices(s).map((t) => t.name)).toEqual(TYPES.slice(0, 4).map((t) => t.name));
    expect(typeChoices(s, true).map((t) => t.name)).not.toContain('Hidden Type');
    expect(typeChoices(s, true).length).toBe(5);
  });
});

describe('saving', () => {
  it('Save needs a reading; with one it saves, and the save carries the form\'s own values, the reading and byVoice', () => {
    const s = confirm();
    expect(assistantReducer(s, { type: 'SAVE', ready: false })).toBe(s);
    const saving = assistantReducer(s, { type: 'SAVE', ready: true });
    expect(saving.phase).toBe('saving');
    expect(isSpinning(saving)).toBe(true);
    const reading = { lat: 47.38, lng: -122.23, accuracyM: 12, takenAtMs: 1, device: 'phone' as const };
    expect(saveValues(saving, reading)).toEqual({
      customerId: 'c1', date: TODAY, purpose: TYPES[0].name, notes: 'Dropped samples', outcome: 'Wants a quote', followUp: '', followUpDate: '',
      image: [], loggedFrom: reading, byVoice: true
    });
  });
  it('a follow-up the type does not allow is not sent', () => {
    let s = run([{ type: 'TURN_OK', draft: draft({ customerQuery: 'x', visitType: 'Resource Placement', notes: 'n', followUp: 'Call', followUpDate: '2026-12-01' }), rank: clear() }], thinking());
    expect(saveValues(s, null)).toMatchObject({ followUp: '', followUpDate: '', byVoice: true, loggedFrom: null });
    s = run([{ type: 'EDIT', field: 'visitType', value: TYPES[0].name }], s);
    expect(saveValues(s, null)).toMatchObject({ followUp: 'Call', followUpDate: '2026-12-01' });
  });
  it('cannot save without a customer or a type', () => {
    const s = run([{ type: 'TURN_OK', draft: draft({ customerQuery: 'x' }), rank: clear() }], thinking());
    expect(assistantReducer(s, { type: 'SAVE', ready: true })).toBe(s);
  });
  it('saved: shows Undo for ten seconds', () => {
    const saving = assistantReducer(confirm(), { type: 'SAVE', ready: true });
    const saved = assistantReducer(saving, { type: 'SAVE_OK', visitId: 'v1', customerId: 'c1', now: 1000 });
    expect(saved.phase).toBe('saved');
    expect(saved.saved).toEqual({ visitId: 'v1', customerId: 'c1', undoUntil: 1000 + UNDO_WINDOW_MS });
    expect(undoLeftMs(saved, 1000)).toBe(10_000);
    expect(undoLeftMs(saved, 6000)).toBe(5000);
    expect(undoLeftMs(saved, 99_000)).toBe(0);
    const expired = assistantReducer(saved, { type: 'UNDO_EXPIRED' });
    expect(expired.undo).toBe('expired');
    expect(undoLeftMs(expired, 2000)).toBe(0);
    expect(assistantReducer(expired, { type: 'UNDO' })).toBe(expired);
  });
  it('undo deletes the visit and closes', () => {
    const saved = run([{ type: 'SAVE', ready: true }, { type: 'SAVE_OK', visitId: 'v1', customerId: 'c1', now: 0 }], confirm());
    const working = assistantReducer(saved, { type: 'UNDO' });
    expect(working.undo).toBe('working');
    expect(assistantReducer(working, { type: 'UNDO_OK' })).toMatchObject({ phase: 'idle', lastResult: 'undone' });
    const failed = assistantReducer(working, { type: 'UNDO_FAILED' });
    expect(failed.phase).toBe('saved');
    expect(failed.undo).toBe('failed');
    expect(undoLeftMs(failed, 1)).toBe(0);
  });
  it('a failed save closes the sheet — the page puts the entries back in the ordinary form', () => {
    const s = run([{ type: 'SAVE', ready: true }, { type: 'SAVE_FAILED' }], confirm());
    expect(s).toMatchObject({ phase: 'idle', lastResult: 'save-failed' });
  });
  it('"Add another" starts again, keeping the visit types', () => {
    const saved = run([{ type: 'SAVE', ready: true }, { type: 'SAVE_OK', visitId: 'v1', customerId: 'c1', now: 0 }], confirm());
    const again = assistantReducer(saved, { type: 'ADD_ANOTHER', today: '2026-11-29' });
    expect(again.phase).toBe('listening');
    expect(again.customer).toBeNull();
    expect(again.draft).toEqual(EMPTY_SPOKEN_VISIT);
    expect(again.types).toBe(TYPES);
    expect(again.today).toBe('2026-11-29');
    expect(again.said).toEqual([]);
  });
  it('a late save answer after Cancel is ignored', () => {
    const closed = run([{ type: 'SAVE', ready: true }, { type: 'CANCEL' }], confirm());
    expect(closed.phase).toBe('idle');
    expect(assistantReducer(closed, { type: 'SAVE_OK', visitId: 'v', customerId: 'c', now: 0 })).toBe(closed);
  });
});

describe('cancel', () => {
  const phases: [Phase, AssistantState][] = [
    ['permission', run([open('undetermined')])],
    ['listening', run([open()])],
    ['thinking', thinking()],
    ['pick', run([{ type: 'TURN_OK', draft: draft({ customerQuery: 'x' }), rank: { verdict: 'ambiguous', candidates: [KENT, TACOMA] } }], thinking())],
    ['ask', run([{ type: 'TURN_OK', draft: draft({ customerQuery: 'x' }), rank: clear() }], thinking())],
    ['confirm', confirm()],
    ['search', run([{ type: 'OPEN_SEARCH' }], confirm())],
    ['typing', run([open(), { type: 'TYPE_INSTEAD' }])],
    ['saving', run([{ type: 'SAVE', ready: true }], confirm())],
    ['saved', run([{ type: 'SAVE', ready: true }, { type: 'SAVE_OK', visitId: 'v', customerId: 'c1', now: 0 }], confirm())],
    ['error', run([open('denied')])]
  ];
  it.each(phases)('closes from %s and forgets the visit', (phase, state) => {
    expect(state.phase).toBe(phase);
    const s = assistantReducer(state, { type: 'CANCEL' });
    expect(s.phase).toBe('idle');
    expect(s.customer).toBeNull();
    expect(s.draft).toEqual(EMPTY_SPOKEN_VISIT);
    expect(s.said).toEqual([]);
    expect(s.lastResult).toBe('cancelled');
  });
  it('can be reopened afterwards', () => {
    const s = run([open(), { type: 'CANCEL' }, open()]);
    expect(s.phase).toBe('listening');
  });
});
