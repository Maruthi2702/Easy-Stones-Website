import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormRow, FormField, FormPicker, FormSearchPicker } from '../../../components/shared/form/FormControls';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import { useCustomerOptions } from '../../../api/customerOptions';
import { cleanExpense, defaultSubOf, fieldsOf, formatMoney, usDate } from '../../../utils/cardReceipts';
import { MAX_BATCH, batchSummary, rowReadiness } from '../../../utils/receiptBatch';
import type { ReceiptScan } from '../../../utils/receiptScan';
import type { ExpenseBody, UploadOptions, UploadResult } from '../cardReceiptsApi';
import CardToggle from '../components/CardToggle';
import WarnLines from '../components/WarnLines';
import { lastCardFor, rememberCard } from '../cardChoice';
import type { AddableHolder, Card, Category, Expense } from '../types';
import { useReceiptBatch, type BatchRow } from './useReceiptBatch';

export type BulkReceiptsFormProps = {
  /** Everyone a receipt can be added for (their cards come with them). */
  holders: AddableHolder[];
  /** The signed-in person's own cards: "Me" is offered when there are any. */
  ownCards: Card[];
  meId: string;
  categories: Category[];
  today: string;
  upload: (data: string, opts?: UploadOptions) => Promise<UploadResult>;
  scan?: (url: string) => Promise<{ scan: ReceiptScan }>;
  addOne: (id: string, body: ExpenseBody) => Promise<{ expense: Expense; matchedMissing: boolean }>;
  /** The batch is over (some saved): the list reloads. */
  onSaved: (summary: string) => void;
  onClose: () => void;
};

const money = (v: string) => { const n = Number(v); return Number.isFinite(n) && v.trim() ? formatMoney(Math.round(n * 100)) : ''; };

/**
 * Add several receipts at once (owner's ask 2026-11-24, Accounting and Admins): pick ONE cardholder and ONE card,
 * drop the files, give each its own category and note, Save all. Each becomes its own receipt (a complete one goes to
 * approval, an incomplete one is kept as a draft, owner's call) and the Amex check still matches each to its charge.
 * The cardholder is locked once files are in, so one batch can't mix people.
 */
export default function BulkReceiptsForm({ holders, ownCards, meId, categories, today, upload, scan, addOne, onSaved, onClose }: BulkReceiptsFormProps) {
  const batch = useReceiptBatch({ today, categories, upload, scan, addOne });
  const { rows } = batch;
  const [holderId, setHolderId] = useState(() => (ownCards.length ? meId : ''));
  const cards = holderId === meId ? ownCards : holders.find((h) => h.id === holderId)?.cards ?? [];
  const [cardId, setCardId] = useState(() => lastCardFor(holderId, cards));
  const [problem, setProblem] = useState('');
  const [over, setOver] = useState(false);
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const customers = useCustomerOptions();
  const customerOptions = useMemo(() => customers.options.map((o) => ({ value: o.value, label: o.label, description: o.description, keywords: o.keywords })), [customers.options]);
  const categoryOptions = categories.filter((c) => c.active).map((c) => ({ value: c.name, label: c.label, keywords: c.label }));

  const holderName = holderId === meId ? 'Me' : holders.find((h) => h.id === holderId)?.name || '';
  const locked = rows.length > 0;
  const ready = Boolean(holderId) && cards.length > 0;
  const pickHolder = (id: string) => {
    setHolderId(id);
    const list = id === meId ? ownCards : holders.find((h) => h.id === id)?.cards ?? [];
    setCardId(lastCardFor(id, list));
  };
  const take = (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    setProblem(batch.addFiles(list));
  };

  /** What one row sends: its fields, whose it is, which card, and "3 of 5". */
  const send = (r: BatchRow, n: number, of: number): ExpenseBody => ({
    ...r.values,
    ...(cards.length > 1 ? { cardId } : {}),
    ...(holderId !== meId ? { onBehalfOf: holderId } : {}),
    batch: { n, of }
  } as ExpenseBody);

  const saved = rows.filter((r) => r.save === 'saved');
  const failed = rows.filter((r) => r.save === 'failed' || r.save === 'repeat');
  const summary = batchSummary(saved.map((r) => r.saved!), failed.length);
  const allSaved = rows.length > 0 && saved.length === rows.length;
  const left = rows.length - saved.length;
  const blockedCount = batch.blocked.length;

  const saveAll = async () => {
    if (batch.busy || saving) return;
    setSaving(true);
    try {
      await batch.saveAll(send);
      if (cards.length > 1) rememberCard(holderId, cardId);
      setFinished(true);
    } finally { setSaving(false); }
  };
  const done = () => { onSaved(batchSummary(saved.map((r) => r.saved!), 0)); onClose(); };

  // Closing with receipts not yet saved asks first (FormModal's own check) via dirtyCount.
  const dirtyCount = allSaved ? 0 : left;
  const submitLabel = allSaved ? 'Done' : finished && failed.length ? `Retry ${left} not saved` : `Save all (${left})`;
  const submitDisabled = !allSaved && (batch.busy || saving || !rows.length || blockedCount > 0 || batch.todo.every((r) => r.save === 'repeat'));

  return (
    <FormModal
      title={<>Add several receipts{holderName && locked ? <span className="fm-title-sub"> · {holderName}</span> : null}</>}
      size="l"
      onClose={allSaved ? done : onClose}
      onSubmit={allSaved ? done : saveAll}
      submitLabel={submitLabel}
      saving={saving}
      submitDisabled={submitDisabled}
      dirtyCount={dirtyCount}
      discardTitle="Discard these receipts?"
      footerNote={!allSaved && rows.length ? (
        blockedCount ? <span>{blockedCount} {blockedCount === 1 ? 'receipt needs' : 'receipts need'} a merchant, date and total first</span>
          : <span>{batch.ready} ready for approval · {rows.length - batch.ready - saved.length} will be saved as {rows.length - batch.ready - saved.length === 1 ? 'a draft' : 'drafts'}</span>
      ) : null}
    >
      {finished && summary ? <div className={`ccr-form-error${failed.length ? '' : ' is-ok'}`} role="status">{summary}</div> : null}

      <FormSection>
        <FormField name="holder" id="ccr-bulk-holder" label="Receipts for" required>
          <FormSearchPicker id="ccr-bulk-holder" value={holderId} onChange={pickHolder} keepInForm disabled={locked}
            options={[
              ...(ownCards.length ? [{ value: meId, label: 'Me', description: ownCards[0]?.label }] : []),
              ...holders.filter((h) => h.id !== meId).map((h) => ({ value: h.id, label: h.name, description: h.cards.map((c) => c.label).join(' · ') }))
            ]}
            placeholder="Choose one cardholder" searchPlaceholder="Type a name" sheetTitle="Receipts for" selectedLabel={holderName} />
        </FormField>
        {locked ? (
          <p className="ccr-remind-note">One cardholder per batch. To add for someone else, <button type="button" className="ccr-textbtn" disabled={batch.busy || saving || saved.length > 0} onClick={() => { batch.clear(); setFinished(false); setProblem(''); }}>start over</button>.</p>
        ) : holderId && !cards.length ? (
          <p className="ccr-remind-note" role="alert">{holderName} doesn’t have a company card set up yet.</p>
        ) : null}
      </FormSection>

      {cards.length > 1 ? (
        <FormSection>
          {locked ? <p className="ccr-remind-note">Every receipt here goes on {cards.find((c) => c._id === cardId)?.label}.</p>
            : <CardToggle cards={cards} value={cardId} onChange={setCardId} lastId={lastCardFor(holderId, cards)} />}
        </FormSection>
      ) : null}

      {ready && !allSaved && rows.length < MAX_BATCH ? (
        <div className={`ccr-bulk-drop${over ? ' is-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}>
          <Upload size={20} aria-hidden="true" />
          <button type="button" className="ccr-textbtn" onClick={() => fileRef.current?.click()}>
            {rows.length ? 'Add more photos or PDFs' : 'Choose photos or PDFs'}
          </button>
          <span className="ccr-sub">or drop them here · up to {MAX_BATCH} ({rows.length} added)</span>
          <input ref={fileRef} type="file" accept="application/pdf,image/*" multiple hidden onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
        </div>
      ) : null}
      {problem ? <div className="ccr-form-error" role="alert">{problem}</div> : null}

      {rows.map((r, i) => (
        <Row key={r.key} row={r} index={i} sameAs={batch.sameAs[r.key]} categories={categories} today={today} customerOptions={customerOptions} customersLoading={customers.loading}
          categoryOptions={categoryOptions} check={batch.check(r)} locked={saving} onOpen={() => batch.toggle(r.key)} onRemove={() => batch.remove(r.key)}
          onChange={(v) => batch.setValues(r.key, v)} onSaveAnyway={() => batch.saveAnyway(r.key, send)} />
      ))}
    </FormModal>
  );
}

type RowProps = {
  row: BatchRow; index: number; categories: Category[]; today: string; check: ReturnType<typeof cleanExpense>;
  /** The number of an earlier row in this batch with the same file, if any. */
  sameAs?: number;
  customerOptions: { value: string; label: string; description?: string; keywords?: string }[]; customersLoading: boolean;
  categoryOptions: { value: string; label: string; keywords?: string }[]; locked: boolean;
  onOpen: () => void; onRemove: () => void; onChange: (v: Partial<BatchRow['values']>) => void; onSaveAnyway: () => void;
};

/** One receipt of the batch: a summary line, and (open) its own fields. */
function Row({ row, index, sameAs, categories, today, check, customerOptions, customersLoading, categoryOptions, locked, onOpen, onRemove, onChange, onSaveAnyway }: RowProps) {
  const v = row.values;
  const category = categories.find((c) => c.name === v.category);
  const fields = fieldsOf(category, v.subcategory);
  const subs = (category?.subcategories || []).filter((s) => s.active).map((s) => ({ value: s.name, label: s.label, keywords: s.label }));
  const state = rowReadiness(check);
  const working = row.stage === 'uploading' || row.stage === 'reading';
  const idp = `ccr-bulk-${row.key}`;
  // What is needed to save at all shows as soon as the row is open; the rest (category, note…) only if the server asks.
  const need = { ...check.problems, ...row.problems };
  const chip = row.save === 'saved' ? (row.saved?.status === 'waiting' ? 'Sent for approval' : 'Saved as a draft')
    : row.save === 'saving' ? 'Saving…'
    : row.save === 'repeat' ? 'Looks already saved'
    : row.save === 'failed' ? 'Didn’t save'
    : row.stage === 'uploading' ? 'Uploading…' : row.stage === 'reading' ? 'Reading…'
    : row.stage === 'unreadable' ? 'Upload failed'
    : state === 'ready' ? 'Ready' : state === 'draft' ? (check.missing.category ? 'Needs a category' : 'Draft · needs details') : 'Needs merchant, date, total';
  const tone = row.save === 'saved' ? 'ok' : row.save === 'failed' || row.save === 'repeat' || row.stage === 'unreadable' || (state === 'blocked' && !working) ? 'bad' : state === 'ready' ? 'ok' : 'wait';
  const isImage = row.file.type !== 'application/pdf';
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!isImage) return undefined;
    const url = URL.createObjectURL(row.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [row.file, isImage]);
  const saved = row.save === 'saved';

  return (
    <section className={`ccr-bulk-row${row.open ? ' is-open' : ''}`} aria-label={`Receipt ${index + 1}`}>
      <div className="ccr-bulk-head">
        <span className="ccr-bulk-thumb" aria-hidden="true">{preview ? <img src={preview} alt="" /> : <FileText size={20} />}</span>
        <button type="button" className="ccr-bulk-sum" onClick={onOpen} aria-expanded={row.open} disabled={working}>
          <b>{v.merchant.trim() || (working ? row.file.name : 'Merchant needed')}</b>
          <span className="ccr-sub">{[v.date ? usDate(v.date) : '', money(v.total), category?.label || ''].filter(Boolean).join(' · ') || row.file.name}</span>
        </button>
        <span className={`ccr-bulk-chip is-${tone}`}>{working || row.save === 'saving' ? <Loader2 size={13} className="ccr-spin" aria-hidden="true" /> : saved ? <Check size={13} aria-hidden="true" /> : null}{chip}</span>
        {!saved ? <button type="button" className="ccr-bulk-x" aria-label={`Remove receipt ${index + 1}`} onClick={onRemove} disabled={locked || row.save === 'saving'}><Trash2 size={16} aria-hidden="true" /></button> : null}
        {!working && !saved ? <button type="button" className="ccr-bulk-x" aria-label={row.open ? 'Close' : 'Fill in'} onClick={onOpen}>{row.open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button> : null}
      </div>

      {row.error ? <div className="ccr-form-error" role="alert">{row.error}</div> : null}
      {row.repeat ? (
        <div className="ccr-form-error" role="alert">
          You already saved {row.repeat.merchant}, {formatMoney(row.repeat.cents)} on {usDate(row.repeat.date)}. Is this a second purchase?
          <button type="button" className="fm-btn fm-btn-small" onClick={onSaveAnyway} disabled={locked}>Save anyway</button>
        </div>
      ) : null}
      {row.note && row.open ? <p className="ccr-sub">{row.note}</p> : null}
      {!saved ? <WarnLines lines={[sameAs ? `Same photo as receipt ${sameAs} in this batch. Remove one unless they’re two purchases.` : '', row.dupLine]} /> : null}

      {row.open && !saved && !working ? (
        <div className="ccr-bulk-body" onKeyDown={(e) => {
          // Enter inside a row's field must not save the whole batch (FormModal submits on Enter).
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault();
        }}>
          <FormSection>
            <FormField name="merchant" id={`${idp}-m`} label="Merchant" required error={need.merchant}>
              <input id={`${idp}-m`} className="fm-input" autoComplete="off" maxLength={80} placeholder="Where it was paid" value={v.merchant} onChange={(e) => onChange({ merchant: e.target.value })} />
            </FormField>
            <FormRow>
              <FormField name="date" id={`${idp}-d`} label="Date" required error={need.date}>
                <DatePicker id={`${idp}-d`} value={v.date} max={today} today={today} onChange={(d) => onChange({ date: d })} sheetTitle="Date" />
              </FormField>
              <FormField name="total" id={`${idp}-t`} label="Total" required error={need.total}>
                <div className="ccr-money"><span aria-hidden="true">$</span>
                  <input id={`${idp}-t`} className="fm-input" inputMode="decimal" autoComplete="off" placeholder="0.00" value={v.total} onChange={(e) => onChange({ total: e.target.value })} />
                </div>
              </FormField>
            </FormRow>
          </FormSection>
          <FormSection>
            <FormField name="category" id={`${idp}-c`} label="Category" required error={row.problems.category}>
              <FormSearchPicker id={`${idp}-c`} value={v.category} options={categoryOptions} placeholder="Choose a category" searchPlaceholder="Search categories" sheetTitle="Category" maxResults={200} keepInForm
                onChange={(c) => onChange({ category: c, subcategory: defaultSubOf(categories.find((o) => o.name === c))?.name || '' })} />
            </FormField>
            {subs.length ? (
              <FormField name="subcategory" id={`${idp}-s`} label="Sub-category" required error={row.problems.subcategory}>
                <FormPicker id={`${idp}-s`} value={v.subcategory} onChange={(s) => onChange({ subcategory: s })} options={subs} placeholder="Choose the type" sheetTitle="Sub-category" keepInForm />
              </FormField>
            ) : null}
            {fields.customer ? (
              <FormField name="customer" id={`${idp}-u`} label="Customer" required error={row.problems.customer}>
                <FormSearchPicker id={`${idp}-u`} value={v.customerId} selectedLabel={v.customerName} options={customerOptions} loading={customersLoading}
                  placeholder="Choose the customer" searchPlaceholder="Search name, city or contact" sheetTitle="Customer" keepInForm
                  onChange={(id) => onChange({ customerId: id, customerName: customerOptions.find((c) => c.value === id)?.label || '' })} />
              </FormField>
            ) : null}
            {fields.recurring ? (
              <label className="ccr-check"><input type="checkbox" checked={v.recurring} onChange={(e) => onChange({ recurring: e.target.checked })} /> Recurring every month</label>
            ) : null}
            <FormField name="note" id={`${idp}-n`} label="Note" required={fields.note} error={row.problems.note}>
              <textarea id={`${idp}-n`} className="fm-input fm-textarea" rows={2} maxLength={500} autoCapitalize="sentences" placeholder="Why it was bought / anything the approver should know" value={v.note} onChange={(e) => onChange({ note: e.target.value })} />
            </FormField>
          </FormSection>
        </div>
      ) : null}
    </section>
  );
}
