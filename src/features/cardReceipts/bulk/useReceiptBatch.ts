import { useCallback, useRef, useState } from 'react';
import { newVisitId } from '../../../utils/visitForm';
import { compressImage, fileToBase64 } from '../../../utils/attachmentFiles';
import { duplicatePhotoLine, receiptFileProblem } from '../../../utils/receiptFile';
import { fingerprintOf } from '../receiptFingerprint';
import { cleanExpense, type ExpenseInput, type ExpenseProblems } from '../../../utils/cardReceipts';
import { fillFromScan, scanLine, type ReceiptScan } from '../../../utils/receiptScan';
import { MAX_BATCH, batchLeftOut, batchRoom, rowReadiness } from '../../../utils/receiptBatch';
import type { ExpenseBody, UploadOptions, UploadResult } from '../cardReceiptsApi';
import type { Category, Expense } from '../types';

export type RowValues = Required<Omit<ExpenseInput, 'recurring'>> & { recurring: boolean };
export const blankRow = (today: string): RowValues => ({
  date: today, merchant: '', total: '', subtotal: '', tax: '', tip: '', category: '', subcategory: '', customerId: '', customerName: '',
  attendees: [], purpose: '', note: '', recurring: false, receiptUrl: '', lostReason: ''
});

/** `new`: not saved yet. `repeat`: the server thinks it is already saved (Save anyway is the person's call). */
export type RowSave = 'new' | 'saving' | 'saved' | 'failed' | 'repeat';
export type BatchRow = {
  /** Also the receipt's id: a retry of the same row can't make a second receipt. */
  key: string;
  file: File;
  values: RowValues;
  stage: 'uploading' | 'reading' | 'ready' | 'unreadable';
  /** What reading did ("Filled merchant, date… Check them") or why it couldn't. */
  note: string;
  open: boolean;
  save: RowSave;
  error: string;
  problems: ExpenseProblems;
  repeat: { merchant: string; date: string; cents: number } | null;
  saved: { status: string; matchedMissing: boolean } | null;
  /** The file's fingerprint ('' until it's worked out, or when the browser can't). */
  hash: string;
  /** The photo is already on a saved receipt (a warning, src/utils/receiptFile.ts's duplicatePhotoLine). */
  dupLine: string;
};

type Deps = {
  today: string;
  categories: Category[];
  upload: (data: string, opts?: UploadOptions) => Promise<UploadResult>;
  scan?: (url: string) => Promise<{ scan: ReceiptScan }>;
  /** Saves one receipt under the id the row carries. */
  addOne: (id: string, body: ExpenseBody) => Promise<{ expense: Expense; matchedMissing: boolean }>;
};

/** Runs at most `n` jobs at once, in the order they were queued. */
function queue(n: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  const next = () => { if (running < n && waiting.length) { running++; waiting.shift()!(); } };
  return <T,>(job: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    waiting.push(() => { job().then(resolve, reject).finally(() => { running--; next(); }); });
    next();
  });
}

/**
 * The batch's rows (Add several receipts). Each file uploads the moment it is picked and is then read, a few at a
 * time; the person fills in each row's category and note; Save all sends one `POST /expenses` per row, in order,
 * with the row's own id. Nothing here knows who the receipts are for: the form sends that with every save.
 */
export function useReceiptBatch({ today, categories, upload, scan, addOne }: Deps) {
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [left, setLeft] = useState('');
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const uploads = useRef(queue(3));
  const reads = useRef(queue(2));

  const patch = useCallback((key: string, change: Partial<BatchRow> | ((r: BatchRow) => Partial<BatchRow>)) => {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...(typeof change === 'function' ? change(r) : change) } : r)));
  }, []);
  const setValues = (key: string, v: Partial<RowValues>) => patch(key, (r) => ({ values: { ...r.values, ...v }, save: r.save === 'repeat' || r.save === 'failed' ? 'new' : r.save, error: '', problems: {}, repeat: null }));

  const offered = categories.filter((c) => c.active);
  const check = (r: BatchRow) => cleanExpense(r.values, { today, categories: offered });

  const startRow = (key: string, file: File) => {
    uploads.current(async () => {
      let url = '';
      let hash = '';
      let dupLine = '';
      try {
        let data: string;
        [data, hash] = await Promise.all([
          file.type === 'application/pdf' ? fileToBase64(file) : compressImage(file, 2000, 0.8),
          fingerprintOf(file)
        ]);
        const res = await upload(data, { hash });
        url = res.url;
        dupLine = duplicatePhotoLine(res.duplicate);
      } catch (err) {
        patch(key, { stage: 'unreadable', error: (err as Error).message || 'Could not upload this file.' });
        return;
      }
      patch(key, (r) => ({ values: { ...r.values, receiptUrl: url }, stage: scan ? 'reading' : 'ready', note: '', open: !scan, hash, dupLine }));
      if (!scan) return;
      await reads.current(async () => {
        try {
          const { scan: read } = await scan(url);
          if (!read.isReceipt) { patch(key, { stage: 'ready', note: 'This doesn’t look like a receipt. Check the photo.', open: true }); return; }
          patch(key, (r) => {
            const out = fillFromScan(r.values, read, { startDate: today });
            return { values: out.values, stage: 'ready', note: scanLine(out.filled) || 'Couldn’t read the details. Type them in.', open: true };
          });
        } catch (err) {
          // 503 = reading isn't set up: say nothing, the row is typed by hand.
          patch(key, { stage: 'ready', note: (err as { status?: number }).status === 503 ? '' : 'Couldn’t read the details. Type them in.', open: true });
        }
      });
    });
  };

  /** Adds the files (the ones that fail the file check or don't fit are named once, not added). Returns a problem to show, or ''. */
  const addFiles = (files: File[]): string => {
    const have = rowsRef.current.length;
    const room = batchRoom(have);
    const taken: File[] = [];
    let problem = '';
    for (const f of files) {
      const why = receiptFileProblem(f);
      if (why) { problem = problem || `${f.name}: ${why}`; continue; }
      if (taken.length < room) taken.push(f);
    }
    const out = problem || batchLeftOut(have, files.filter((f) => !receiptFileProblem(f)).length);
    setLeft(out);
    const fresh: BatchRow[] = taken.map((file) => ({
      key: newVisitId(), file, values: blankRow(today), stage: 'uploading', note: '', open: false, save: 'new', error: '', problems: {}, repeat: null, saved: null,
      hash: '', dupLine: ''
    }));
    setRows((list) => [...list, ...fresh]);
    fresh.forEach((r) => startRow(r.key, r.file));
    return out;
  };

  const remove = (key: string) => setRows((list) => list.filter((r) => r.key !== key || r.save === 'saved'));
  const clear = () => { setRows([]); setLeft(''); };
  const toggle = (key: string) => patch(key, (r) => ({ open: !r.open }));

  // The same file picked twice in this batch: each later row names the first one's number (1-based).
  const sameAs: Record<string, number> = {};
  const firstWith = new Map<string, number>();
  rows.forEach((r, i) => {
    if (!r.hash) return;
    const first = firstWith.get(r.hash);
    if (first == null) firstWith.set(r.hash, i); else sameAs[r.key] = first + 1;
  });

  const busy = rows.some((r) => r.stage === 'uploading' || r.stage === 'reading' || r.save === 'saving');
  const todo = rows.filter((r) => r.save !== 'saved');
  const blocked = todo.filter((r) => r.stage === 'unreadable' || rowReadiness(check(r)) === 'blocked');
  const ready = todo.filter((r) => r.stage === 'ready' && rowReadiness(check(r)) === 'ready').length;

  /** Saves the rows not yet saved, one after the other (a failed one is named and the rest still go). A row that looked like a repeat waits for its own Save anyway. */
  const saveAll = async (send: (r: BatchRow, n: number, of: number) => ExpenseBody): Promise<void> => {
    const of = rowsRef.current.length;
    for (const first of [...rowsRef.current]) {
      const now = rowsRef.current.find((x) => x.key === first.key);
      if (!now || now.save === 'saved' || now.save === 'repeat') continue;
      const n = rowsRef.current.findIndex((x) => x.key === first.key) + 1;
      patch(now.key, { save: 'saving', error: '' });
      try {
        const res = await addOne(now.key, send(now, n, of));
        patch(now.key, { save: 'saved', saved: { status: res.expense.status, matchedMissing: res.matchedMissing }, open: false, error: '', repeat: null });
      } catch (err) {
        const e = err as Error & { problems?: ExpenseProblems; repeat?: BatchRow['repeat'] };
        patch(now.key, e.repeat
          ? { save: 'repeat', repeat: e.repeat, error: '', open: true }
          : { save: 'failed', error: e.message || 'Could not save this receipt.', problems: e.problems && typeof e.problems === 'object' ? e.problems : {}, open: true });
      }
    }
  };
  /** Save anyway on one row that looked like a repeat. */
  const saveAnyway = (key: string, send: (r: BatchRow, n: number, of: number) => ExpenseBody) => saveOne(key, send);
  const saveOne = async (key: string, send: (r: BatchRow, n: number, of: number) => ExpenseBody) => {
    const now = rowsRef.current.find((x) => x.key === key);
    if (!now) return;
    const n = rowsRef.current.findIndex((x) => x.key === key) + 1;
    patch(key, { save: 'saving', error: '' });
    try {
      const res = await addOne(key, { ...send(now, n, rowsRef.current.length), confirmRepeat: true });
      patch(key, { save: 'saved', saved: { status: res.expense.status, matchedMissing: res.matchedMissing }, open: false, error: '', repeat: null });
    } catch (err) {
      patch(key, { save: 'failed', error: (err as Error).message || 'Could not save this receipt.', open: true });
    }
  };

  return { rows, left, busy, todo, blocked, ready, check, sameAs, setValues, addFiles, remove, clear, toggle, saveAll, saveAnyway, max: MAX_BATCH };
}
