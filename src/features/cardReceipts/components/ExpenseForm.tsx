import { useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import BillCard, { type BillField, type BillValues } from './BillCard';
import BillDetailsEdit from './BillDetailsEdit';
import ReceiptPreview from './ReceiptPreview';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField, FormPicker, FormSearchPicker } from '../../../components/shared/form/FormControls';
import type { FormOption } from '../../../components/shared/form/FormControls';
import { goToField } from '../../../components/shared/form/formFocus';
import { useCustomerOptions } from '../../../api/customerOptions';
import { compressImage, fileToBase64 } from '../../../utils/attachmentFiles';
import { centsText, cleanExpense, defaultSubOf, fieldsOf, formatMoney, missingLine, usDate, type ExpenseInput, type ExpenseProblems } from '../../../utils/cardReceipts';
import { fillFromScan, scanLine, type ReceiptScan } from '../../../utils/receiptScan';
import { isPdfUrl } from '../cardReceiptsView';
import type { ExpenseBody } from '../cardReceiptsApi';
import type { Category, Expense } from '../types';

type Values = Required<Omit<ExpenseInput, 'recurring'>> & { recurring: boolean };

const blank = (today: string): Values => ({
  date: today, merchant: '', total: '', subtotal: '', tax: '', tip: '', category: '', subcategory: '', customerId: '', customerName: '',
  attendees: [], purpose: '', note: '', recurring: false, receiptUrl: '', lostReason: ''
});
const fromExpense = (e: Expense): Values => ({
  date: e.date, merchant: e.merchant, total: centsText(e.cents), subtotal: centsText(e.subtotalCents), tax: centsText(e.taxCents),
  tip: centsText(e.tipCents), category: e.category, subcategory: e.subcategory, customerId: e.customerId, customerName: e.customerName, attendees: e.attendees,
  purpose: e.purpose, note: e.note, recurring: e.recurring, receiptUrl: e.receiptUrl, lostReason: e.lostReason
});

const LABELS = { receipt: 'Receipt', lostReason: 'Why there’s no receipt', date: 'Date', merchant: 'Merchant', total: 'Total', subtotal: 'Subtotal', tax: 'Tax', tip: 'Tip', category: 'Category', subcategory: 'Sub-category', customer: 'Customer', attendees: 'Who attended', purpose: 'Business purpose' };
/** The fields on the Edit bill details screen (the pencil); the rest are on the form itself. */
const BILL_FIELDS: readonly BillField[] = ['merchant', 'date', 'total', 'subtotal', 'tax', 'tip'];
const isBillField = (k: string): k is BillField => (BILL_FIELDS as readonly string[]).includes(k);
const billOf = (v: Values): BillValues => ({ merchant: v.merchant, date: v.date, total: v.total, subtotal: v.subtotal, tax: v.tax, tip: v.tip });
const pick = (p: ExpenseProblems, bill: boolean): ExpenseProblems =>
  Object.fromEntries(Object.entries(p).filter(([k]) => isBillField(k) === bill)) as ExpenseProblems;

export type ExpenseFormProps = {
  /** Editing this expense; absent to add one. */
  expense?: Expense | null;
  /** Start in "Lost receipt" (the phone's Lost receipt button). */
  startLost?: boolean;
  cardLabel: string;
  holderName: string;
  categories: Category[];
  today: string;
  upload: (data: string) => Promise<{ url: string }>;
  /** Reads an uploaded receipt (src/routes/cardReceiptScan.ts); absent = no reading. */
  scan?: (url: string) => Promise<{ scan: ReceiptScan }>;
  onSave: (values: ExpenseBody) => Promise<unknown>;
  onClose: () => void;
};

/**
 * Add / Edit receipt, on the form template (FORM_TEMPLATE.md), laid out like
 * Splitwise's bill screen (owner, 2026-11-20): the Bill details card (photo,
 * merchant, total, subtotal, tax, tip — BillCard), then the category (and what
 * that category asks for) and a note. The pencil opens Edit bill details in
 * the same window (BillDetailsEdit): merchant, date, total, subtotal, tax, tip.
 *
 * The photo or PDF uploads the moment it's picked; Save sends its address.
 * Date, merchant and total are needed to save at all; until the receipt (or a
 * lost-receipt reason), the category and the category's own fields are there
 * it saves as a draft, and once they are it goes to the approver. The same day
 * and total already saved asks "Save anyway?" first. After an upload, `scan`
 * reads the receipt and fills the fields that are still empty
 * (src/utils/receiptScan.ts); the card says which, so they get checked, and
 * when merchant or total are still blank the edit screen opens for them.
 */
export default function ExpenseForm({ expense, startLost = false, cardLabel, holderName, categories, today, upload, scan, onSave, onClose }: ExpenseFormProps) {
  const editing = Boolean(expense);
  const start = useMemo(() => (expense ? fromExpense(expense) : blank(today)), [expense, today]);
  const [values, setValues] = useState<Values>(start);
  const [lost, setLost] = useState(Boolean(expense?.lostReason) || startLost);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [serverError, setServerError] = useState('');
  const [serverProblems, setServerProblems] = useState<ExpenseProblems>({});
  const [repeat, setRepeat] = useState<{ merchant: string; date: string; cents: number } | null>(null);
  const [person, setPerson] = useState('');
  // Which screen of the window: the form, or Edit bill details (the pencil).
  const [view, setView] = useState<'form' | 'bill'>('form');
  const [billStart, setBillStart] = useState<BillValues | null>(null);
  const [billSubmitted, setBillSubmitted] = useState(false);
  // The receipt shown large at the top of the window while the details are checked or typed.
  const [viewing, setViewing] = useState(false);
  // Reading the receipt after an upload, and what it filled in.
  const [reading, setReading] = useState(false);
  const [readLine, setReadLine] = useState('');
  const readSeq = useRef(0);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const fileRef = useRef<HTMLInputElement>(null);
  const customers = useCustomerOptions();

  // A hidden category stays offered on the expense that already has it.
  const offered = categories.filter((c) => c.active || c.name === start.category);
  const category = offered.find((c) => c.name === values.category);
  const fields = fieldsOf(category, values.subcategory);
  const body: ExpenseBody = { ...values, receiptUrl: lost ? '' : values.receiptUrl, lostReason: lost ? values.lostReason : '' };
  const check = cleanExpense(body, { today, categories: offered, currentSubcategory: start.subcategory });
  const problems: ExpenseProblems = { ...check.problems, ...serverProblems };
  const complete = Object.keys(check.missing).length === 0;

  const set = (patch: Partial<Values>) => { setValues((v) => ({ ...v, ...patch })); setServerProblems({}); setRepeat(null); };
  const dirty = (Object.keys(start) as (keyof Values)[]).filter((k) => JSON.stringify(values[k]) !== JSON.stringify(start[k])).length
    + (lost !== (Boolean(expense?.lostReason) || startLost) ? 1 : 0);

  /** Opens Edit bill details, remembering what was there so ✕ can put it back. */
  const openBill = (focus?: BillField, showErrors = false) => {
    setBillStart(billOf(valuesRef.current));
    setBillSubmitted(showErrors);
    setView('bill');
    if (focus) setTimeout(() => goToField(focus), 60);
  };
  const closeBill = (keep: boolean) => {
    if (!keep && billStart) set(billStart);
    setView('form');
  };
  const submitBill = () => {
    const bill = pick(problems, true);
    const first = BILL_FIELDS.find((k) => bill[k]);
    if (first) { setBillSubmitted(true); goToField(first); return; }
    closeBill(true);
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setServerError('');
    setReadLine('');
    let url = '';
    try {
      const data = file.type === 'application/pdf' ? await fileToBase64(file) : await compressImage(file, 2000, 0.8);
      ({ url } = await upload(data));
      set({ receiptUrl: url });
      setLost(false);
    } catch (err) {
      setServerError((err as Error).message || 'Could not upload the receipt. Try again.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
    if (!url) return;
    if (scan) readReceipt(url, file.type !== 'application/pdf');
    else askForDetails(valuesRef.current, file.type !== 'application/pdf');
  };

  // Nothing read (or reading is off): open Edit bill details, with the photo large to type from.
  const askForDetails = (now: Values, image: boolean) => {
    if (now.merchant.trim() && now.total.trim()) return;
    if (image) setViewing(true);
    openBill(now.merchant.trim() ? 'total' : 'merchant');
  };

  // Fills only the fields still empty when the answer comes back, so nothing typed meanwhile is lost.
  // A newer photo's reading wins over an older one still on its way.
  const readReceipt = async (url: string, image: boolean) => {
    const seq = ++readSeq.current;
    setReading(true);
    let after = valuesRef.current;
    try {
      const { scan: read } = await scan!(url);
      if (seq !== readSeq.current) return;
      if (!read.isReceipt) { setReadLine('This doesn’t look like a receipt. Check the photo.'); return; }
      const { values: next, filled } = fillFromScan(valuesRef.current, read, { startDate: editing ? '' : today });
      if (filled.length) { set(next); after = next; }
      setReadLine(scanLine(filled) || 'Couldn’t read the details. Type them in.');
    } catch (err) {
      // 503 = reading isn't set up on this server: say nothing, the form works as before.
      if (seq === readSeq.current && (err as { status?: number }).status !== 503) setReadLine('Couldn’t read the details. Type them in.');
    } finally {
      if (seq === readSeq.current) {
        setReading(false);
        askForDetails(after, image);
      }
    }
  };

  const addPerson = () => {
    const name = person.trim();
    if (!name || values.attendees.includes(name)) { setPerson(''); return; }
    set({ attendees: [...values.attendees, name] });
    setPerson('');
  };

  const submit = async (confirmRepeat = false) => {
    setSubmitted(true);
    const first = (Object.keys(LABELS) as (keyof typeof LABELS)[]).find((k) => problems[k as keyof ExpenseProblems]);
    // A problem in the bill details is fixed on the edit screen.
    if (first && isBillField(first)) { openBill(first, true); return; }
    if (first) { goToField(first); return; }
    setSaving(true);
    setServerError('');
    try {
      await onSave({ ...body, ...(confirmRepeat ? { confirmRepeat: true } : {}) });
    } catch (err) {
      const e = err as Error & { problems?: ExpenseProblems; repeat?: { merchant: string; date: string; cents: number } | null };
      const fromServer = e.problems && typeof e.problems === 'object' ? e.problems : {};
      setServerProblems(fromServer);
      setRepeat(e.repeat || null);
      setServerError(e.message);
      setSaving(false);
      const billProblem = BILL_FIELDS.find((k) => fromServer[k]);
      if (billProblem) openBill(billProblem, true);
    }
  };

  const categoryOptions: FormOption[] = offered.map((c) => ({ value: c.name, label: c.active ? c.label : `${c.label} (hidden)`, keywords: c.label }));
  // The category's types: the shown ones, plus the one this expense already has if it was hidden since.
  const subOptions: FormOption[] = (category?.subcategories || [])
    .filter((s) => s.active || s.name === start.subcategory)
    .map((s) => ({ value: s.name, label: s.active ? s.label : `${s.label} (hidden)`, keywords: s.label }));
  const customerOptions = useMemo(() => customers.options.map((o) => ({ value: o.value, label: o.label, description: o.description, keywords: o.keywords })), [customers.options]);
  const missing = missingLine(check.missing);
  const footerNote = complete ? 'Goes to your approver when it’s saved.' : missing ? `Saves as a draft. Still to do: ${missing.toLowerCase()}.` : null;
  const cardNote = reading ? 'Reading the receipt…' : readLine;
  const onBillScreen = view === 'bill';

  // The photo slot: take one when there is none, else see it large (a PDF opens in its own tab).
  const onPhoto = () => {
    if (!values.receiptUrl || lost) { fileRef.current?.click(); return; }
    if (isPdfUrl(values.receiptUrl)) { window.open(values.receiptUrl, '_blank', 'noreferrer'); return; }
    setViewing((v) => !v);
  };

  return (
    <FormModal
      title={onBillScreen ? 'Edit bill details' : editing ? <>Edit receipt <span className="fm-title-sub">· {expense?.merchant}</span></> : <>Add receipt <span className="fm-title-sub">· {cardLabel}</span></>}
      size="m"
      onClose={onBillScreen ? () => closeBill(false) : onClose}
      onSubmit={onBillScreen ? submitBill : () => submit(false)}
      submitLabel={onBillScreen ? 'Save' : complete ? 'Send for approval' : 'Save draft'}
      saving={onBillScreen ? false : saving}
      submitDisabled={onBillScreen ? false : uploading || reading || (editing && !dirty)}
      dirtyCount={onBillScreen ? 0 : dirty}
      discardTitle={editing ? 'Discard your changes?' : 'Discard this receipt?'}
      errors={onBillScreen ? (billSubmitted ? pick(problems, true) : {}) : (submitted ? pick(problems, false) : {})}
      showErrors={onBillScreen ? billSubmitted : submitted}
      fieldLabels={LABELS}
      footerNote={onBillScreen ? null : footerNote}
    >
      {serverError ? (
        <div className="ccr-form-error" role="alert">
          {repeat
            ? <>You already saved {repeat.merchant}, {formatMoney(repeat.cents)} on {usDate(repeat.date)}. Is this a second purchase?
              <button type="button" className="fm-btn fm-btn-small" onClick={() => { setView('form'); submit(true); }} disabled={saving}>Save anyway</button></>
            : serverError}
        </div>
      ) : null}

      {viewing && !lost && values.receiptUrl && !isPdfUrl(values.receiptUrl)
        ? <ReceiptPreview url={values.receiptUrl} onClose={() => setViewing(false)} />
        : null}

      {/* One file picker for both screens. */}
      <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => pickFile(e.target.files?.[0])} />

      {onBillScreen ? (
        <BillDetailsEdit values={billOf(values)} errors={billSubmitted ? pick(problems, true) : {}} today={today} set={set} />
      ) : (
        <>
          <FormSection>
            <FormField name="receipt" id="ccr-file-btn" label="Bill details" error={submitted ? problems.receipt : ''}>
              <BillCard {...billOf(values)} receiptUrl={lost ? '' : values.receiptUrl} lost={lost} uploading={uploading} note={cardNote}
                viewingLarge={viewing} onPhoto={onPhoto} onEdit={(focus) => openBill(focus)} />
              <div className="ccr-bill-links">
                {!lost ? (
                  <>
                    <button id="ccr-file-btn" type="button" className="ccr-textbtn" onClick={() => fileRef.current?.click()} disabled={uploading}>
                      {values.receiptUrl ? 'Replace the photo' : 'Take photo or choose file'}
                    </button>
                    <button type="button" className="ccr-textbtn" onClick={() => setLost(true)} disabled={uploading}>I lost the receipt</button>
                  </>
                ) : (
                  <button type="button" className="ccr-textbtn" onClick={() => setLost(false)}>Found it? Upload the receipt instead</button>
                )}
              </div>
            </FormField>
            {lost ? (
              <FormField name="lostReason" id="ccr-lost" label="Why there’s no receipt" required error={submitted ? (problems.lostReason || problems.receipt) : ''}>
                <textarea id="ccr-lost" className="fm-input fm-textarea" rows={3} maxLength={500} autoCapitalize="sentences"
                  value={values.lostReason} onChange={(e) => set({ lostReason: e.target.value })} />
              </FormField>
            ) : null}
          </FormSection>

          <FormSection>
            <FormField name="category" id="ccr-category" label="Category" required error={(submitted ? problems.category : '') || (submitted ? check.missing.category : '')}>
              <FormPicker id="ccr-category" value={values.category}
                onChange={(c) => set({ category: c, subcategory: defaultSubOf(offered.find((o) => o.name === c))?.name || '' })} options={categoryOptions}
                placeholder="Choose a category" sheetTitle="Category" error={submitted ? problems.category : ''} keepInForm />
            </FormField>
            {subOptions.length ? (
              <FormField name="subcategory" id="ccr-subcategory" label="Sub-category" required error={(submitted ? problems.subcategory : '') || (submitted ? check.missing.subcategory : '')}>
                <FormPicker id="ccr-subcategory" value={values.subcategory} onChange={(s) => set({ subcategory: s })} options={subOptions}
                  placeholder="Choose the type" sheetTitle="Sub-category" error={submitted ? problems.subcategory : ''} keepInForm />
              </FormField>
            ) : null}
            {fields.customer ? (
              <FormField name="customer" id="ccr-customer" label="Customer" required error={submitted ? check.missing.customer : ''}>
                <FormSearchPicker id="ccr-customer" value={values.customerId} selectedLabel={values.customerName}
                  onChange={(id) => set({ customerId: id, customerName: customers.options.find((c) => c.value === id)?.label || '' })}
                  options={customerOptions} loading={customers.loading} placeholder="Choose the customer"
                  searchPlaceholder="Search name, city or contact" sheetTitle="Customer" keepInForm />
              </FormField>
            ) : null}
            {fields.attendees ? (
              <FormField name="attendees" id="ccr-person" label="Who attended" required error={submitted ? check.missing.attendees : ''}>
                {values.attendees.length ? (
                  <div className="ccr-people" style={{ marginBottom: 8 }}>
                    {values.attendees.map((a) => (
                      <span key={a} className="ccr-person">{a}
                        <button type="button" aria-label={`Remove ${a}`} onClick={() => set({ attendees: values.attendees.filter((x) => x !== a) })}><X size={14} /></button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="ccr-add-person">
                  <input id="ccr-person" className="fm-input" autoComplete="off" maxLength={80} placeholder={values.attendees.length ? 'Add another name' : `${holderName}, and who else?`}
                    value={person} onChange={(e) => setPerson(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPerson(); } }} />
                  <button type="button" className="fm-btn fm-btn-small" onClick={addPerson} disabled={!person.trim()}>Add</button>
                </div>
              </FormField>
            ) : null}
            {fields.purpose ? (
              <FormField name="purpose" id="ccr-purpose" label="Business purpose" required error={submitted ? check.missing.purpose : ''}>
                <textarea id="ccr-purpose" className="fm-input fm-textarea" rows={2} maxLength={500} autoCapitalize="sentences" value={values.purpose} onChange={(e) => set({ purpose: e.target.value })} />
              </FormField>
            ) : null}
            {fields.recurring ? (
              <label className="ccr-check"><input type="checkbox" checked={values.recurring} onChange={(e) => set({ recurring: e.target.checked })} /> Recurring every month</label>
            ) : null}
            <FormField id="ccr-note" label="Note">
              <textarea id="ccr-note" className="fm-input fm-textarea" rows={2} maxLength={500} autoCapitalize="sentences" placeholder="Anything the approver should know" value={values.note} onChange={(e) => set({ note: e.target.value })} />
            </FormField>
          </FormSection>
        </>
      )}
    </FormModal>
  );
}
