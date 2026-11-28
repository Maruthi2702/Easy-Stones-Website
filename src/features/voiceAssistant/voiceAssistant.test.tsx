// @vitest-environment jsdom
// The assistant's screens with a fake speech recognizer and a fake server: when the button shows, every state the sheet draws,
// the save, the undo, the failure ladder, Esc and focus. (No real browser or phone: see the manual checks in the commit message.)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { stubGeolocation } from '../location/testing/geolocation';
import type { SpeechDriver } from './speechDriver';

const authFetch = vi.fn();
vi.mock('../../api/authFetch', () => ({ authFetch: (...args: unknown[]) => authFetch(...args) }));

const { default: VoiceAssistant } = await import('./VoiceAssistant');
const { default: VoiceChip } = await import('./VoiceChip');
const { clearCustomers } = await import('../../api/customerOptions');
const { clearTypeLists } = await import('../../api/typeLists');
const { resetWordsCache } = await import('./assistantApi');
const { SILENCE_MS } = await import('./useAssistant');

const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const CUSTOMERS = [
  { _id: 'c1', company: 'Smith Granite', city: 'Kent' },
  { _id: 'c2', company: 'Smith Granite', city: 'Tacoma' },
  { _id: 'c3', company: 'Cascade Fabrication', city: 'Seattle' }
];
const TYPES = [
  { _id: 't1', name: 'Unscheduled in Person Sales Call', label: 'Unscheduled sales call', order: 1, active: true, system: true, fields: { notes: true, outcome: true, followUp: 'optional' } },
  { _id: 't2', name: 'Scheduled in Person Sales Meeting', label: 'Scheduled sales meeting', order: 2, active: true, system: true, fields: { notes: true, outcome: true, followUp: 'optional' } },
  { _id: 't3', name: 'Resource Placement', label: 'Resource placement', order: 3, active: true, system: true, fields: { notes: true, outcome: false, followUp: 'none' } }
];
const DRAFT = { customerQuery: '', cityHint: '', visitType: '', visitDate: '', notes: '', outcome: '', followUp: '', followUpDate: '' };

let turnReply: (body: Record<string, unknown>) => unknown;
const turns: Record<string, unknown>[] = [];

beforeEach(() => {
  authFetch.mockReset();
  turns.length = 0;
  turnReply = () => reply(200, { ok: true, draft: { ...DRAFT, customerQuery: 'Cascade Fabrication', visitType: TYPES[0].name, notes: 'Dropped samples', outcome: 'Wants a quote' } });
  authFetch.mockImplementation(async (url: string, init?: { body?: string }) => {
    const u = String(url);
    if (u.includes('/api/customers/dropdown')) return reply(200, CUSTOMERS);
    if (u.includes('/api/visit-types')) return reply(200, { types: TYPES });
    if (u.includes('/api/assistant/words')) return reply(200, { version: 'v1', hints: ['Calacatta Gold'] });
    if (u.includes('/api/assistant/turn')) { const body = JSON.parse(init?.body || '{}'); turns.push(body); return turnReply(body); }
    return reply(404, {});
  });
  clearCustomers(); clearTypeLists(); resetWordsCache();
  window.localStorage.clear();
  stubGeolocation();
});
afterEach(() => { cleanup(); document.body.removeAttribute('style'); });

/** A recognizer you can drive: say words, stop it, break it. */
function fakeSpeech(over: { available?: boolean; permission?: 'granted' | 'denied' | 'undetermined'; listenError?: Error } = {}) {
  const partial: Array<(t: string) => void> = [];
  const level: Array<(n: number) => void> = [];
  const error: Array<(e: { code: string; message: string }) => void> = [];
  let said = '';
  const abort = vi.fn(async () => {});
  const listen = vi.fn(async (_options: { hints: string[] }) => {
    if (over.listenError) throw over.listenError;
    said = '';
    return {
      stop: async () => ({ text: said }),
      abort,
      onPartial: (cb: (t: string) => void) => { partial.push(cb); return () => { partial.splice(partial.indexOf(cb), 1); }; },
      onLevel: (cb: (n: number) => void) => { level.push(cb); return () => { level.splice(level.indexOf(cb), 1); }; },
      onError: (cb: (e: { code: string; message: string }) => void) => { error.push(cb); return () => { error.splice(error.indexOf(cb), 1); }; }
    };
  });
  const requestPermission = vi.fn(async () => ({ granted: true, canAskAgain: false }));
  const driver: SpeechDriver = {
    availability: async () => ({ available: over.available ?? true, onDevice: true, permission: over.permission ?? 'granted' }),
    requestPermission,
    listen
  };
  return {
    driver, listen, abort, requestPermission,
    say: (text: string) => { said = text; act(() => partial.forEach((cb) => cb(text))); },
    level: (n: number) => act(() => level.forEach((cb) => cb(n))),
    fail: (code: string) => act(() => error.forEach((cb) => cb({ code, message: code })))
  };
}

const makeHost = () => ({
  userId: 'u1',
  saveVisit: vi.fn(async (_values: Record<string, unknown>) => ({ ok: true, visitId: 'v-new', customerId: 'c3' })),
  undoVisit: vi.fn(async (_visitId: string, _customerId: string) => true),
  openForm: vi.fn(),
  addCustomer: vi.fn()
});

async function mount(speech = fakeSpeech(), host = makeHost(), enabled = true) {
  const view = render(<VoiceAssistant enabled={enabled} placement="plus" host={host} speech={speech.driver} />);
  return { speech, host, view };
}
const openSheet = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Talk to the assistant/ }));
  return screen.findByRole('dialog');
};
const sayAndFinish = async (speech: ReturnType<typeof fakeSpeech>, text: string) => {
  await waitFor(() => expect(speech.listen).toHaveBeenCalled());
  speech.say(text);
  fireEvent.click(await screen.findByRole('button', { name: /Done talking/ }));
};

describe('the button', () => {
  it('shows only with the switch AND a phone that can do speech', async () => {
    const { view } = await mount(fakeSpeech({ available: false }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('button', { name: /Talk to the assistant/ })).toBeNull();
    view.unmount();
    await mount(fakeSpeech(), makeHost(), false);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('button', { name: /Talk to the assistant/ })).toBeNull();
    cleanup();
    await mount();
    expect(await screen.findByRole('button', { name: /Talk to the assistant/ })).toBeTruthy();
  });
  it('rests until the assistant is listening: the logo is not spinning', async () => {
    await mount();
    await screen.findByRole('button', { name: /Talk to the assistant/ });
    expect(document.querySelector('.va-fab .va-logo')?.classList.contains('is-spinning')).toBe(false);
  });
  it('is hidden from the page while the sheet is open, and back after', async () => {
    await mount();
    await openSheet();
    expect(document.querySelector('.va-fab-wrap')?.classList.contains('is-hidden')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.querySelector('.va-fab-wrap')?.classList.contains('is-hidden')).toBe(false);
  });
});

describe('listening', () => {
  it('opens a labelled dialog, locks the page, hands the recognizer its hints and lights the newest word', async () => {
    const { speech } = await mount();
    const dialog = await openSheet();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('va-caption');
    expect(document.getElementById('va-caption')?.textContent).toContain('Listening');
    expect(document.body.style.position).toBe('fixed');
    await waitFor(() => expect(speech.listen).toHaveBeenCalledTimes(1));
    const hints = (speech.listen.mock.calls[0][0] as { hints: string[] }).hints;
    expect(Array.isArray(hints)).toBe(true);
    speech.say('log a visit at cascade fab');
    await waitFor(() => expect(document.querySelector('.va-last')?.textContent).toBe('fab'));
    expect(document.querySelector('.va-live')?.textContent).toContain('log a visit at cascade');
  });
  it('the logo spins while listening', async () => {
    await mount();
    await openSheet();
    expect(document.querySelector('.va-caption .va-logo')?.classList.contains('is-spinning')).toBe(true);
  });
  it('sends the turn by itself after a quiet moment', async () => {
    const speech = fakeSpeech();
    await mount(speech);
    await openSheet();
    await waitFor(() => expect(speech.listen).toHaveBeenCalled());
    speech.say('log a visit at cascade fabrication');
    await waitFor(() => expect(turns.length).toBe(1), { timeout: SILENCE_MS + 2500 });
    expect(turns[0].text).toBe('log a visit at cascade fabrication');
  }, 8000);
});

describe('one sentence, then the card', () => {
  it('goes listening → thinking → the confirm card, then saves with the reading and byVoice, then offers Undo', async () => {
    const { speech, host } = await mount();
    await openSheet();
    await sayAndFinish(speech, 'log a visit at cascade fabrication dropped samples');
    // The words were sent with today's date; no draft on the first turn.
    await waitFor(() => expect(turns.length).toBe(1));
    expect(turns[0]).toMatchObject({ text: 'log a visit at cascade fabrication dropped samples' });
    expect(turns[0].draft).toBeUndefined();
    expect(String(turns[0].today)).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(await screen.findByText('Does this look right?')).toBeTruthy();
    const rows = screen.getAllByRole('listitem').map((r) => r.textContent);
    expect(rows[0]).toContain('Cascade Fabrication');
    expect(rows[0]).toContain('Seattle');
    expect(rows[1]).toContain('Unscheduled sales call');
    expect(rows.some((r) => r?.includes('Dropped samples'))).toBe(true);

    // Save waits for the location reading, then goes through the page's one visit save.
    const save = screen.getByRole('button', { name: 'Save visit' }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(host.saveVisit).toHaveBeenCalledTimes(1));
    const values = host.saveVisit.mock.calls[0][0];
    expect(values).toMatchObject({
      customerId: 'c3', purpose: TYPES[0].name, notes: 'Dropped samples', outcome: 'Wants a quote', byVoice: true, image: []
    });
    expect(values.loggedFrom).toMatchObject({ lat: 47.6062, lng: -122.3321, device: 'computer' });
    expect(String(values.date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Saved: the sheet becomes a bar that leaves the page usable; Undo is there for ten seconds.
    const bar = await screen.findByRole('status', { name: 'Visit saved' });
    expect(within(bar).getByText('Visit saved')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.position).toBe('');
    fireEvent.click(within(bar).getByRole('button', { name: /Undo/ }));
    await waitFor(() => expect(host.undoVisit).toHaveBeenCalledWith('v-new', 'c3'));
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Visit saved' })).toBeNull());
  });

  it('Save stays locked until a location reading is in', async () => {
    stubGeolocation({ permission: 'prompt' });
    // A device that never answers: the reading never arrives.
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: vi.fn() } });
    const { speech, host } = await mount();
    await openSheet();
    await sayAndFinish(speech, 'visit at cascade fabrication');
    const save = (await screen.findByRole('button', { name: 'Save visit' })) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText(/Getting your location/)).toBeTruthy();
    fireEvent.click(save);
    expect(host.saveVisit).not.toHaveBeenCalled();
  });

  it('every field can be fixed by a tap: the day with the shared calendar, never a native date input', async () => {
    const { speech } = await mount();
    await openSheet();
    await sayAndFinish(speech, 'visit at cascade fabrication');
    fireEvent.click(await screen.findByRole('button', { name: /^Day: Today/ }));
    expect(document.querySelector('input[type="date"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
    expect(await screen.findByRole('button', { name: /^Day: Yesterday/ })).toBeTruthy();
    // The type: chips from Admin → Visit Types.
    fireEvent.click(screen.getByRole('button', { name: /^Visit type:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Resource placement' }));
    expect(await screen.findByRole('button', { name: /^Visit type: Resource placement/ })).toBeTruthy();
    // Notes: an inline editor with the words in it.
    fireEvent.click(screen.getByRole('button', { name: /^Notes:/ }));
    const box = await screen.findByRole('textbox', { name: 'Notes' });
    expect((box as HTMLTextAreaElement).value).toBe('Dropped samples');
    fireEvent.change(box, { target: { value: 'Showed Calacatta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('button', { name: /^Notes: Showed Calacatta/ })).toBeTruthy();
  });

  it('"Open the form" hands the understood visit to the ordinary form', async () => {
    const { speech, host } = await mount();
    await openSheet();
    await sayAndFinish(speech, 'visit at cascade fabrication');
    fireEvent.click(await screen.findByRole('button', { name: 'Open the form' }));
    expect(host.openForm).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'c3', purpose: TYPES[0].name, notes: 'Dropped samples' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('asking, one question at a time', () => {
  it('asks for what is missing with the mic reopened, then sends the answer with the draft and the question', async () => {
    turnReply = (body) => reply(200, {
      ok: true,
      draft: body.asking === 'type'
        ? { ...DRAFT, customerQuery: 'Cascade Fabrication', visitType: TYPES[1].name, notes: 'Dropped samples', outcome: 'Wants a quote' }
        : { ...DRAFT, customerQuery: 'Cascade Fabrication', notes: 'Dropped samples' }
    });
    const { speech } = await mount();
    await openSheet();
    await sayAndFinish(speech, 'cascade fabrication dropped samples');
    expect(await screen.findByRole('heading', { name: 'What kind of visit was it?' })).toBeTruthy();
    // The first four types as chips, and the mic is already open again.
    expect(screen.getByRole('button', { name: 'Scheduled sales meeting' })).toBeTruthy();
    await waitFor(() => expect(speech.listen).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('Listening for your answer…')).toBeTruthy());
    speech.say('a scheduled meeting');
    fireEvent.click(await screen.findByRole('button', { name: /Done talking/ }));
    await waitFor(() => expect(turns.length).toBe(2));
    expect(turns[1]).toMatchObject({ text: 'a scheduled meeting', asking: 'type', draft: expect.objectContaining({ notes: 'Dropped samples' }) });
    expect(await screen.findByText('Does this look right?')).toBeTruthy();
  });

  it('a tap on a type chip answers the question without speaking', async () => {
    turnReply = () => reply(200, { ok: true, draft: { ...DRAFT, customerQuery: 'Cascade Fabrication', notes: 'Dropped samples', outcome: 'Wants a quote' } });
    const { speech } = await mount();
    await openSheet();
    await sayAndFinish(speech, 'cascade fabrication dropped samples');
    fireEvent.click(await screen.findByRole('button', { name: 'Unscheduled sales call' }));
    expect(await screen.findByText('Does this look right?')).toBeTruthy();
    expect(turns.length).toBe(1);
  });

  it('a question about notes can be skipped', async () => {
    turnReply = () => reply(200, { ok: true, draft: { ...DRAFT, customerQuery: 'Cascade Fabrication', visitType: TYPES[2].name } });
    const { speech } = await mount();
    await openSheet();
    await sayAndFinish(speech, 'resource placement at cascade fabrication');
    expect(await screen.findByRole('heading', { name: 'What happened? Say the notes.' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByText('Does this look right?')).toBeTruthy();
  });
});

describe('two customers that sound alike', () => {
  it('shows "Which one?" with each city, and a tap picks', async () => {
    turnReply = () => reply(200, { ok: true, draft: { ...DRAFT, customerQuery: 'Smith Granite', visitType: TYPES[2].name, notes: 'Dropped samples' } });
    const { speech } = await mount();
    await openSheet();
    await sayAndFinish(speech, 'smith granite resource placement dropped samples');
    expect(await screen.findByRole('heading', { name: /Which one\?/ })).toBeTruthy();
    const cards = Array.from(document.querySelectorAll('.va-card')) as HTMLElement[];
    expect(cards.map((c) => c.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Kent'), expect.stringContaining('Tacoma')]));
    fireEvent.click(cards.find((c) => c.textContent?.includes('Tacoma'))!);
    expect(await screen.findByText('Does this look right?')).toBeTruthy();
    expect(screen.getAllByRole('listitem')[0].textContent).toContain('Tacoma');
  });

  it('a name that matches nobody offers recent customers and a search; Add customer when nothing is found', async () => {
    window.localStorage.setItem('dashboardCustomerSearch.recent.u1', JSON.stringify(['c3']));
    turnReply = () => reply(200, { ok: true, draft: { ...DRAFT, customerQuery: 'Zebra Plumbing' } });
    const { speech, host } = await mount();
    await openSheet();
    await sayAndFinish(speech, 'visit at zebra plumbing');
    expect(await screen.findByRole('heading', { name: 'I didn’t catch the customer' })).toBeTruthy();
    expect(screen.getByText(/I heard “Zebra Plumbing”/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Cascade Fabrication/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Search by name/ }));
    const box = await screen.findByRole('textbox', { name: 'Find a customer' });
    fireEvent.change(box, { target: { value: 'Zebra' } });
    expect(await screen.findByText(/No customer called “Zebra”/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Add customer/ }));
    expect(host.addCustomer).toHaveBeenCalledWith('Zebra');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('search finds a customer by its sound', async () => {
    turnReply = () => reply(200, { ok: true, draft: { ...DRAFT, customerQuery: 'Zebra Plumbing' } });
    const { speech } = await mount();
    await openSheet();
    await sayAndFinish(speech, 'visit at zebra plumbing');
    fireEvent.click(await screen.findByRole('button', { name: /Search by name/ }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Find a customer' }), { target: { value: 'cascade fab' } });
    fireEvent.click(await screen.findByRole('option', { name: /Cascade Fabrication/ }));
    expect(await screen.findByRole('heading', { name: 'What kind of visit was it?' })).toBeTruthy();
  });
});

describe('the failure ladder', () => {
  it('the assistant failing opens the ordinary form with the words in Notes', async () => {
    turnReply = () => reply(503, {});
    const { speech, host } = await mount();
    await openSheet();
    await sayAndFinish(speech, 'visit at cascade fabrication dropped samples');
    expect(await screen.findByText('The assistant isn’t available right now')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open the form with my words' }));
    expect(host.openForm).toHaveBeenCalledWith(expect.objectContaining({ notes: 'visit at cascade fabrication dropped samples' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('the daily limit is its own message', async () => {
    turnReply = () => reply(429, { message: 'limit' });
    const { speech } = await mount();
    await openSheet();
    await sayAndFinish(speech, 'visit at cascade fabrication');
    expect(await screen.findByText('You’ve used today’s turns')).toBeTruthy();
  });
  it('no connection is its own message', async () => {
    turnReply = () => { throw new TypeError('offline'); };
    const { speech } = await mount();
    await openSheet();
    await sayAndFinish(speech, 'visit at cascade fabrication');
    expect(await screen.findByText('No signal right now')).toBeTruthy();
  });
  it('nothing heard says so and lets the person say it again', async () => {
    const { speech } = await mount();
    await openSheet();
    await waitFor(() => expect(speech.listen).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: /Done talking/ }));
    expect(await screen.findByText('I didn’t catch that')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Say it again' }));
    await waitFor(() => expect(speech.listen).toHaveBeenCalledTimes(2));
  });
  it('a turn the server could not read is the same "didn\'t catch that"', async () => {
    turnReply = () => reply(200, { ok: false, reason: 'empty', message: '' });
    const { speech } = await mount();
    await openSheet();
    await sayAndFinish(speech, 'uh');
    expect(await screen.findByText('I didn’t catch that')).toBeTruthy();
  });
  it('a turned-off microphone shows the steps and a way to type', async () => {
    await mount(fakeSpeech({ permission: 'denied' }));
    await openSheet();
    expect(await screen.findByText('The microphone is off')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Type the visit' }));
    expect(await screen.findByRole('textbox', { name: 'Type what happened' })).toBeTruthy();
  });
  it('asks for the microphone first when the phone has not been asked, then listens', async () => {
    const speech = fakeSpeech({ permission: 'undetermined' });
    await mount(speech);
    await openSheet();
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect(speech.requestPermission).toHaveBeenCalled();
    await waitFor(() => expect(speech.listen).toHaveBeenCalled());
  });
  it('the recognizer failing mid-sentence for permission is the same steps', async () => {
    const speech = fakeSpeech();
    await mount(speech);
    await openSheet();
    await waitFor(() => expect(speech.listen).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector('.va-bars')).toBeTruthy());
    speech.fail('not-allowed');
    expect(await screen.findByText('The microphone is off')).toBeTruthy();
  });
  it('a recognizer that cannot start is "didn\'t catch that"', async () => {
    await mount(fakeSpeech({ listenError: new Error('busy') }));
    await openSheet();
    expect(await screen.findByText('I didn’t catch that')).toBeTruthy();
  });
  it('a save the page could not make closes the sheet (the page reopens its own form)', async () => {
    const host = makeHost();
    host.saveVisit.mockResolvedValue({ ok: false, visitId: 'v', customerId: 'c3' });
    const { speech } = await mount(fakeSpeech(), host);
    await openSheet();
    await sayAndFinish(speech, 'visit at cascade fabrication');
    const save = (await screen.findByRole('button', { name: 'Save visit' })) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('status', { name: 'Visit saved' })).toBeNull();
  });
});

describe('typing instead', () => {
  it('sends what was typed like a spoken sentence', async () => {
    const { speech } = await mount();
    await openSheet();
    await waitFor(() => expect(speech.listen).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: 'Type instead' }));
    await waitFor(() => expect(speech.abort).toHaveBeenCalled());
    const box = await screen.findByRole('textbox', { name: 'Type what happened' });
    fireEvent.change(box, { target: { value: 'visit at cascade fabrication' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(turns.length).toBe(1));
    expect(turns[0].text).toBe('visit at cascade fabrication');
    expect(await screen.findByText('Does this look right?')).toBeTruthy();
  });
});

describe('closing', () => {
  it('Esc closes, gives the page back and stops the microphone', async () => {
    const { speech } = await mount();
    await openSheet();
    await waitFor(() => expect(speech.listen).toHaveBeenCalled());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.body.style.position).toBe('');
    expect(speech.abort).toHaveBeenCalled();
  });
  it('Esc steps back out of typing before it closes', async () => {
    const { speech } = await mount();
    await openSheet();
    await waitFor(() => expect(speech.listen).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: 'Type instead' }));
    await screen.findByRole('textbox', { name: 'Type what happened' });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Type what happened' })).toBeNull());
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
  it('the dark page behind closes it; the dialog takes focus', async () => {
    await mount();
    const dialog = await openSheet();
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    fireEvent.click(document.querySelector('.va-scrim') as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('Cancel from the thinking state throws the answer away', async () => {
    let release: (v: unknown) => void = () => {};
    turnReply = () => new Promise((resolve) => { release = resolve; });
    const { speech } = await mount();
    await openSheet();
    await sayAndFinish(speech, 'visit at cascade fabrication');
    await waitFor(() => expect(turns.length).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await act(async () => { release(reply(200, { ok: true, draft: { ...DRAFT, customerQuery: 'Cascade Fabrication', visitType: TYPES[0].name } })); await Promise.resolve(); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the Voice chip', () => {
  it('shows only for a visit logged by voice', () => {
    const { container, rerender } = render(<VoiceChip byVoice />);
    expect(container.textContent).toContain('Voice');
    expect(container.querySelector('[title="Logged by voice"]')).toBeTruthy();
    rerender(<VoiceChip byVoice={false} />);
    expect(container.innerHTML).toBe('');
    rerender(<VoiceChip />);
    expect(container.innerHTML).toBe('');
    rerender(<VoiceChip byVoice="true" />);
    expect(container.innerHTML).toBe('');
  });
});
