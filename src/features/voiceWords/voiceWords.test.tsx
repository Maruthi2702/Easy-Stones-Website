// @vitest-environment jsdom
// Render smoke tests for Admin → Voice Assistant (VoiceAssistantPage.tsx): the Words list and its form, Paste a list, Usage, permission gating.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { VoiceWord } from '../../utils/assistantContract';

const api = vi.hoisted(() => ({ loadVoiceWords: vi.fn(), addVoiceWord: vi.fn(), updateVoiceWord: vi.fn(), deleteVoiceWord: vi.fn(), loadUsage: vi.fn() }));
vi.mock('./voiceWordsApi', async () => ({ ...(await vi.importActual<typeof import('./voiceWordsApi')>('./voiceWordsApi')), ...api }));
vi.mock('../voiceTest/openSpeechTest', () => ({ OPEN_MESSAGE: {}, openSpeechTest: vi.fn() }));

const { default: VoiceAssistantPage } = await import('./VoiceAssistantPage');
const { VoiceWordsError } = await import('./voiceWordsApi');

const w = (over: Partial<VoiceWord>): VoiceWord => ({ id: 'x', heard: '', meant: 'Word', kind: 'other', active: true, note: '', updatedAt: '', ...over });
const WORDS = [
  w({ id: '1', meant: 'Calacatta Gold', heard: 'cala cotta gold', kind: 'stone' }),
  w({ id: '2', meant: 'Silestone', kind: 'brand' }),
  w({ id: '3', meant: 'Bellevue', heard: 'bell view', kind: 'branch', active: false })
];
const admin = { role: 'admin', permissions: [] };
const manager = { role: 'manager', permissions: ['manage_voice_words'] };

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); api.loadVoiceWords.mockResolvedValue(WORDS); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Voice Assistant page', () => {
  it('gives a person without the switch nothing, and asks the server nothing', () => {
    const { container } = render(<VoiceAssistantPage currentUser={{ role: 'manager', permissions: ['use_voice_assistant'] }} />);
    expect(container.innerHTML).toBe('');
    expect(api.loadVoiceWords).not.toHaveBeenCalled();
  });

  it('opens on Words for the switch or the admin role, with the three tabs', async () => {
    render(<VoiceAssistantPage currentUser={manager} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Words', 'Usage', 'Speech test']);
    expect(await screen.findByText('Calacatta Gold')).toBeTruthy();
    cleanup();
    render(<VoiceAssistantPage currentUser={admin} />);
    expect(await screen.findByText('Silestone')).toBeTruthy();
  });

  it('lists active words with their kind and heard-as line, hidden ones only under Hidden, and counts per kind', async () => {
    render(<VoiceAssistantPage currentUser={manager} />);
    await screen.findByText('Calacatta Gold');
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent || '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Heard as “cala cotta gold”');
    expect(rows[1]).toContain('Plain word');
    expect(screen.queryByText('Bellevue')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Hidden/ }));
    expect(screen.getByText('Bellevue')).toBeTruthy();
    expect(screen.getByText('Hidden', { selector: '.vw-badge' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /All/ }));
    expect(screen.getByRole('button', { name: /^All 3/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Stone 1/ }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('says what the list is for when it is empty', async () => {
    api.loadVoiceWords.mockResolvedValue([]);
    render(<VoiceAssistantPage currentUser={manager} />);
    expect(await screen.findByText(/teach the assistant our stone names/)).toBeTruthy();
  });

  it('Add word needs the word, then saves it and puts it in the list', async () => {
    api.addVoiceWord.mockResolvedValue(w({ id: '9', meant: 'Taj Mahal', heard: 'tahj mahal', kind: 'stone' }));
    render(<VoiceAssistantPage currentUser={manager} />);
    await screen.findByText('Calacatta Gold');
    fireEvent.click(screen.getAllByRole('button', { name: /Add word/ })[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Heard as/), { target: { value: 'tahj mahal' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add word' }));
    expect(await within(dialog).findAllByText('Enter the word')).not.toHaveLength(0);
    expect(api.addVoiceWord).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Meant/), { target: { value: 'Taj Mahal' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add word' }));
    await waitFor(() => expect(api.addVoiceWord).toHaveBeenCalledWith(expect.objectContaining({ meant: 'Taj Mahal', heard: 'tahj mahal', kind: 'other' })));
    expect(await screen.findByText('Taj Mahal')).toBeTruthy();
  });

  it('shows the server’s duplicate (409) as an error on Heard as', async () => {
    api.addVoiceWord.mockRejectedValue(new VoiceWordsError('exists', 409));
    render(<VoiceAssistantPage currentUser={manager} />);
    await screen.findByText('Calacatta Gold');
    fireEvent.click(screen.getAllByRole('button', { name: /Add word/ })[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Meant/), { target: { value: 'Calacatta Gold' } });
    fireEvent.change(within(dialog).getByLabelText(/Heard as/), { target: { value: 'Cala Cotta Gold' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add word' }));
    expect((await within(dialog).findAllByText(/“Cala Cotta Gold” is already in the list/)).length).toBeGreaterThan(0);
  });

  it('hides a word with the eye button', async () => {
    api.updateVoiceWord.mockResolvedValue({ ...WORDS[1], active: false });
    render(<VoiceAssistantPage currentUser={manager} />);
    await screen.findByText('Silestone');
    fireEvent.click(screen.getByRole('button', { name: 'Hide Silestone' }));
    await waitFor(() => expect(api.updateVoiceWord).toHaveBeenCalledWith('2', { active: false }));
    await waitFor(() => expect(screen.queryByText('Silestone')).toBeNull());
  });

  it('Paste a list previews every line before anything is saved, then adds only the new ones', async () => {
    api.addVoiceWord.mockImplementation(async (input) => w({ id: `n-${input.meant}`, ...input }));
    render(<VoiceAssistantPage currentUser={manager} />);
    await screen.findByText('Calacatta Gold');
    fireEvent.click(screen.getByRole('button', { name: /Paste a list/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/List/), { target: { value: 'sile stone -> Silestone\ncala cotta gold = Calacatta Gold\nQuartzite\nQuartzite' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check the list' }));
    expect(await within(dialog).findByRole('status')).toBeTruthy();
    expect(within(dialog).getByText('Already there')).toBeTruthy();
    expect(within(dialog).getByText('Repeat')).toBeTruthy();
    expect(api.addVoiceWord).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 2 words' }));
    await waitFor(() => expect(api.addVoiceWord).toHaveBeenCalledTimes(2));
    expect(await within(dialog).findByText(/words added/)).toBeTruthy();
    expect(api.addVoiceWord).toHaveBeenCalledWith({ heard: 'sile stone', meant: 'Silestone', kind: 'other' });
  });

  it('Usage shows the month’s tiles and the per-person table, and that nothing is stored', async () => {
    api.loadUsage.mockResolvedValue({ month: '2026-11', turns: 120, failed: 6, inputTokens: 90_000, outputTokens: 12_000, costUsd: 0.0234, people: [
      { userId: 'a', name: 'Zed Zane', turns: 20, failed: 0 }, { userId: 'b', name: 'Amy Ames', turns: 100, failed: 6 }
    ] });
    render(<VoiceAssistantPage currentUser={manager} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Usage' }));
    expect(await screen.findByText('120')).toBeTruthy();
    expect(screen.getByText('$0.023')).toBeTruthy();
    expect(screen.getByText('5% of turns')).toBeTruthy();
    expect(screen.getByText(/never stored/)).toBeTruthy();
    const names = within(screen.getByRole('table')).getAllByRole('rowheader').map((c) => c.textContent);
    expect(names).toEqual(['Amy Ames', 'Zed Zane']);
    expect(api.loadUsage).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/));
  });

  it('the Speech test tab holds the old Voice Test page', async () => {
    render(<VoiceAssistantPage currentUser={admin} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Speech test' }));
    expect(await screen.findByRole('button', { name: /open speech test/i })).toBeTruthy();
  });
});
