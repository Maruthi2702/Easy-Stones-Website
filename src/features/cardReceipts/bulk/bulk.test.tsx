// @vitest-environment jsdom
// Add several receipts: the files upload and are read, each row keeps its own category and note, Save all sends one
// receipt per row (own id, same cardholder, "n of N"), and a failure on one row leaves the others saved.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, renderHook, waitFor } from '@testing-library/react';
import { createHash } from 'node:crypto';
import type { UploadResult } from '../cardReceiptsApi';

vi.mock('../../../utils/attachmentFiles', () => ({ compressImage: async () => 'data:image/jpeg;base64,xx', fileToBase64: async () => 'data:application/pdf;base64,xx' }));
vi.mock('../../../api/customerOptions', () => ({ useCustomerOptions: () => ({ options: [], loading: false }) }));

const { useReceiptBatch } = await import('./useReceiptBatch');
const { default: BulkReceiptsForm } = await import('./BulkReceiptsForm');

const CATEGORIES = [
  { _id: 'k1', name: 'travel_lunch', label: 'Travel Lunch', order: 0, active: true, fields: { customer: false, note: false, recurring: false }, subcategories: [] },
  { _id: 'k2', name: 'fuel', label: 'Fuel', order: 1, active: true, fields: { customer: false, note: false, recurring: false }, subcategories: [] }
] as never[];
// Each file's contents are its name, so its fingerprint says which file an upload is (uploads run three at once and
// finish in any order; the fakes answer by file, not by arrival).
const photo = (name: string) => new File([name], name, { type: 'image/jpeg' });
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const FILE_NO = new Map(['a.jpg', 'b.jpg', 'c.jpg'].map((f, i) => [sha(f), i + 1]));
const scanFor = (merchant: string, cents: number) => ({ scan: { isReceipt: true, date: '2026-10-03', merchant, totalCents: cents, subtotalCents: null, feesCents: null, taxCents: null, tipCents: null, category: '' } });

const deps = () => {
  const upload = vi.fn(async (_data: string, opts?: { hash?: string }): Promise<UploadResult> =>
    ({ url: `https://files/${FILE_NO.get(opts?.hash ?? '') ?? 0}.jpg` }));
  const names = ['Shell', 'Staples', 'Jinya'];
  const scan = vi.fn(async (url: string) => { const n = Number(/(\d+)\.jpg$/.exec(url)?.[1]); return scanFor(names[n - 1]!, 1000 * n); });
  const addOne = vi.fn(async (_id: string, body: Record<string, unknown>) => ({ expense: { status: 'waiting' } as never, matchedMissing: body.merchant === 'Shell' }));
  return { today: '2026-10-20', categories: CATEGORIES, upload, scan, addOne };
};
/** Gives every row a category so it is complete (a row without one is held back, no drafts). */
const complete = (result: { current: { rows: { key: string }[]; setValues: (k: string, v: object) => void } }) =>
  act(() => { result.current.rows.forEach((r) => result.current.setValues(r.key, { category: 'fuel' })); });
afterEach(cleanup);
URL.createObjectURL = () => 'blob:thumb';
URL.revokeObjectURL = () => {};

describe('the batch hook', () => {
  it('uploads and reads each file, then saves one receipt per row with its own category', async () => {
    const d = deps();
    const { result } = renderHook(() => useReceiptBatch(d));
    act(() => { result.current.addFiles([photo('a.jpg'), photo('b.jpg'), photo('c.jpg')]); });
    await waitFor(() => expect(result.current.rows.every((r) => r.stage === 'ready')).toBe(true));
    expect(result.current.rows.map((r) => r.values.merchant)).toEqual(['Shell', 'Staples', 'Jinya']);
    expect(result.current.rows.map((r) => r.values.receiptUrl)).toEqual(['https://files/1.jpg', 'https://files/2.jpg', 'https://files/3.jpg']);
    expect(result.current.rows[0]!.note).toMatch(/Filled in the date, merchant and total/);
    // No category yet: every row is incomplete (none lacks merchant, day or total).
    expect(result.current.blocked).toHaveLength(0);
    expect(result.current.ready).toBe(0);
    const [a, b, c] = result.current.rows;
    act(() => { result.current.setValues(a!.key, { category: 'fuel' }); result.current.setValues(b!.key, { category: 'travel_lunch', note: 'Team lunch' }); });
    expect(result.current.ready).toBe(2);
    let held = -1;
    await act(async () => { held = await result.current.saveAll((r, n, of) => ({ ...r.values, onBehalfOf: 'u7', batch: { n, of } } as never)); });
    // No drafts: the two complete rows are sent; the third is held back, open, with what it lacks shown.
    expect(held).toBe(1);
    expect(d.addOne).toHaveBeenCalledTimes(2);
    const calls = d.addOne.mock.calls;
    expect(calls.map((x) => x[0])).toEqual([a!.key, b!.key]);
    expect(calls.map((x) => x[1].category)).toEqual(['fuel', 'travel_lunch']);
    expect(calls.map((x) => [x[1].onBehalfOf, x[1].batch])).toEqual([['u7', { n: 1, of: 3 }], ['u7', { n: 2, of: 3 }]]);
    expect(result.current.rows.map((r) => r.saved)).toEqual([{ status: 'waiting', matchedMissing: true }, { status: 'waiting', matchedMissing: false }, null]);
    expect(result.current.rows[2]).toMatchObject({ save: 'new', asked: true, open: true });
    expect(result.current.incomplete).toBe(1);
    // Filled in, it goes on the next Save all.
    act(() => { result.current.setValues(c!.key, { category: 'fuel' }); });
    await act(async () => { held = await result.current.saveAll((r, n, of) => ({ ...r.values, batch: { n, of } } as never)); });
    expect(held).toBe(0);
    expect(d.addOne).toHaveBeenCalledTimes(3);
  });

  it('sends each file’s fingerprint, names a file picked twice in the batch, and says when a photo is already on a receipt', async () => {
    const d = deps();
    d.upload.mockImplementation(async (_data: string, opts?: { hash?: string }) => ({
      url: `https://files/${FILE_NO.get(opts?.hash ?? '') ?? 0}.jpg`,
      duplicate: opts?.hash === sha('b.jpg') ? { seen: false } : null
    }));
    const { result } = renderHook(() => useReceiptBatch(d));
    act(() => { result.current.addFiles([photo('a.jpg'), photo('b.jpg'), photo('a.jpg')]); });
    await waitFor(() => expect(result.current.rows.every((r) => r.stage === 'ready')).toBe(true));
    expect(d.upload.mock.calls.map((c) => c[1]?.hash).sort()).toEqual([sha('a.jpg'), sha('a.jpg'), sha('b.jpg')].sort());
    const [a, b, again] = result.current.rows;
    expect(result.current.sameAs).toEqual({ [again!.key]: 1 });
    expect(a!.dupLine).toBe('');
    expect(b!.dupLine).toMatch(/already on another person’s receipt/);
  });

  it('keeps going when one fails, offers Save anyway for a repeat, and never saves a saved row twice', async () => {
    const d = deps();
    d.addOne.mockImplementationOnce(async () => { throw Object.assign(new Error('Could not save the receipt.'), { problems: {} }); });
    d.addOne.mockImplementationOnce(async () => { throw Object.assign(new Error('repeat'), { repeat: { merchant: 'Staples', date: '2026-10-03', cents: 2000 } }); });
    const { result } = renderHook(() => useReceiptBatch(d));
    act(() => { result.current.addFiles([photo('a.jpg'), photo('b.jpg'), photo('c.jpg')]); });
    await waitFor(() => expect(result.current.rows.every((r) => r.stage === 'ready')).toBe(true));
    complete(result);
    const send = (r: { values: object }, n: number, of: number) => ({ ...r.values, batch: { n, of } } as never);
    await act(async () => { await result.current.saveAll(send); });
    expect(result.current.rows.map((r) => r.save)).toEqual(['failed', 'repeat', 'saved']);
    // Retry: the failed one goes again; the repeat waits for its own decision; the saved one is not sent again.
    await act(async () => { await result.current.saveAll(send); });
    expect(d.addOne).toHaveBeenCalledTimes(4);
    expect(result.current.rows.map((r) => r.save)).toEqual(['saved', 'repeat', 'saved']);
    await act(async () => { await result.current.saveAnyway(result.current.rows[1]!.key, send); });
    expect(d.addOne.mock.calls[4]![1]).toMatchObject({ confirmRepeat: true });
    expect(result.current.rows.every((r) => r.save === 'saved')).toBe(true);
  });

  it('updates the saved receipt on a repeat, and keeps the row a repeat when that is refused', async () => {
    const d = deps();
    const mergeOne = vi.fn(async (_savedId: string, _body: Record<string, unknown>) => ({ status: 'waiting' } as never));
    const repeat = { id: 'saved-1', merchant: 'SHELL OIL 5741', date: '2026-10-03', cents: 1000, status: 'waiting', canMerge: true, clearsApprovals: false };
    d.addOne.mockImplementation(async () => { throw Object.assign(new Error('repeat'), { repeat }); });
    const { result } = renderHook(() => useReceiptBatch({ ...d, mergeOne }));
    act(() => { result.current.addFiles([photo('a.jpg'), photo('b.jpg')]); });
    await waitFor(() => expect(result.current.rows.every((r) => r.stage === 'ready')).toBe(true));
    complete(result);
    const send = (r: { values: object }, n: number, of: number) => ({ ...r.values, batch: { n, of } } as never);
    await act(async () => { await result.current.saveAll(send); });
    expect(result.current.rows.map((r) => r.save)).toEqual(['repeat', 'repeat']);
    expect(result.current.canUpdateSaved).toBe(true);

    await act(async () => { await result.current.updateSaved(result.current.rows[0]!.key, send); });
    expect(mergeOne).toHaveBeenCalledWith('saved-1', expect.objectContaining({ receiptUrl: 'https://files/1.jpg', batch: { n: 1, of: 2 } }));
    expect(result.current.rows[0]).toMatchObject({ save: 'saved', saved: { status: 'waiting', matchedMissing: false, merged: true }, repeat: null });

    // Approved meanwhile: the server says 409; the row stays a repeat, without the Update button, and Save anyway is still there.
    mergeOne.mockImplementationOnce(async () => { throw Object.assign(new Error('It’s approved, so it can’t be changed.'), { status: 409 }); });
    await act(async () => { await result.current.updateSaved(result.current.rows[1]!.key, send); });
    expect(result.current.rows[1]).toMatchObject({ save: 'repeat', error: 'It’s approved, so it can’t be changed.', repeat: { canMerge: false } });
  });

  it('takes 25 at most and names a file that isn’t a photo or PDF', () => {
    const d = deps();
    const { result } = renderHook(() => useReceiptBatch(d));
    let said = '';
    act(() => { said = result.current.addFiles(Array.from({ length: 27 }, (_, i) => photo(`r${i}.jpg`))); });
    expect(result.current.rows).toHaveLength(25);
    expect(said).toMatch(/2 files were left out/);
    act(() => { said = result.current.addFiles([new File(['x'], 'notes.docx', { type: 'application/msword' })]); });
    expect(said).toMatch(/notes\.docx/);
    expect(result.current.rows).toHaveLength(25);
  });
});

describe('the Add several window', () => {
  const props = () => ({
    holders: [{ id: 'u7', name: 'Maruthi Ponugupati', cards: [{ _id: 'c7', userId: 'u7', label: 'MARU92069', issuer: 'amex', lastDigits: '92069', active: true }] }] as never[],
    ownCards: [{ _id: 'c1', userId: 'u1', label: 'ANNA11111', issuer: 'amex', lastDigits: '11111', active: true }] as never[],
    meId: 'u1', onSaved: vi.fn(), onClose: vi.fn(), ...deps()
  });

  it('locks the cardholder once files are in and saves them all', async () => {
    const p = props();
    // The reading finds a category on each, so both rows are complete.
    p.scan.mockImplementation(async (url: string) => { const n = Number(/(\d+)\.jpg$/.exec(url)?.[1]); return { scan: { ...scanFor(['Shell', 'Staples'][n - 1]!, 1000 * n).scan, category: 'fuel' } }; });
    const { container } = render(<BulkReceiptsForm {...p} />);
    expect(screen.getByText('Choose photos or PDFs')).toBeTruthy();
    const input = container.ownerDocument.querySelector('input[type=file]') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [photo('a.jpg'), photo('b.jpg')] } }); });
    await waitFor(() => expect(screen.getAllByText('Ready').length).toBe(2));
    expect(screen.getByText(/One cardholder per batch/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Save all \(2\)/ }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save all \(2\)/ })); });
    await waitFor(() => expect(p.addOne).toHaveBeenCalledTimes(2));
    // Saved for "Me" (the signed-in person's own card): no onBehalfOf, one batch of two.
    expect(p.addOne.mock.calls.map((c) => [c[1].onBehalfOf, c[1].batch])).toEqual([[undefined, { n: 1, of: 2 }], [undefined, { n: 2, of: 2 }]]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getAllByText(/Matched the charge on the bank’s report/).length).toBe(1);
    expect(p.onSaved).toHaveBeenCalledWith('2 sent for approval · 1 replaced a report row');
  });

  it('saves nothing for rows that lack a category and shows what each needs, with no drafts', async () => {
    const p = props();
    const { container } = render(<BulkReceiptsForm {...p} />);
    const input = container.ownerDocument.querySelector('input[type=file]') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [photo('a.jpg'), photo('b.jpg')] } }); });
    await waitFor(() => expect(screen.getAllByText(/Needs a category/).length).toBe(2));
    expect(screen.getByText(/0 ready for approval · 2 need details first/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save all \(2\)/ })); });
    expect(p.addOne).not.toHaveBeenCalled();
    expect(screen.getByText(/2 receipts need details before they can be sent/)).toBeTruthy();
    // Each row is open with its category marked.
    await waitFor(() => expect(screen.getAllByText('Choose a category').length).toBeGreaterThanOrEqual(2));
  });
});
