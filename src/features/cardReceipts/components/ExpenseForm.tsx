import { useMemo, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormRow, FormField, FormPicker, FormSearchPicker } from '../../../components/shared/form/FormControls';
import type { FormOption } from '../../../components/shared/form/FormControls';
import { goToField } from '../../../components/shared/form/formFocus';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import { useCustomerOptions } from '../../../api/customerOptions';
import { compressImage, fileToBase64 } from '../../../utils/attachmentFiles';
import { centsText, cleanExpense, fieldsOf, formatMoney, missingLine, usDate, type ExpenseInput, type ExpenseProblems } from '../../../utils/cardReceipts';
import { isPdfUrl } from '../cardReceiptsView';
import type { ExpenseBody } from '../cardReceiptsApi';
import type { Category, Expense } from '../types';

type Values = Required<Omit<ExpenseInput, 'recurring'>> & { recurring: boolean };

const blank = (today: string): Values => ({
  date: today, merchant: '', total: '', subtotal: '', tax: '', tip: '', category: '', customerId: '', customerName: '',
  attendees: [], purpose: '', note: '', recurring: false, receiptUrl: '', lostReason: ''
});
const fromExpense = (e: Expense): Values => ({
  date: e.date, merchant: e.merchant, total: centsText(e.cents), subtotal: centsText(e.subtotalCents), tax: centsText(e.taxCents),
  tip: centsText(e.tipCents), category: e.category, customerId: e.customerId, customerName: e.customerName, attendees: e.attendees,
  purpose: e.purpose, note: e.note, recurring: e.recurring, receiptUrl: e.receiptUrl, lostReason: e.lostReason
});

const LABELS = { receipt: 'Receipt', lostReason: 'Why there’s no receipt', date: 'Date', merchant: 'Merchant', total: 'Total', subtotal: 'Subtotal', tax: 'Tax', tip: 'Tip', category: 'Category', customer: 'Customer', attendees: 'Who attended', purpose: 'Business purpose' };

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
  onSave: (values: ExpenseBody) => Promise<unknown>;
  onClose: () => void;
};

/**
 * Add / Edit receipt, on the form template (FORM_TEMPLATE.md). The photo or
 * PDF uploads the moment it's picked; Save sends its address. Date, merchant
 * and total are needed to save at all; until the receipt (or a lost-receipt
 * reason), the category and the category's own fields are there it saves as a
 * draft, and once they are it goes to the approver. The same day and total
 * already saved asks "Save anyway?" first.
 */
export default function ExpenseForm({ expense, startLost = false, cardLabel, holderName, categories, today, upload, onSave, onClose }: ExpenseFormProps) {
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
  const fileRef = useRef<HTMLInputElement>(null);
  const customers = useCustomerOptions();

  // A hidden category stays offered on the expense that already has it.
  const offered = categories.filter((c) => c.active || c.name === start.category);
  const category = offered.find((c) => c.name === values.category);
  const fields = fieldsOf(category);
  const body: ExpenseBody = { ...values, receiptUrl: lost ? '' : values.receiptUrl, lostReason: lost ? values.lostReason : '' };
  const check = cleanExpense(body, { today, categories: offered });
  const problems: ExpenseProblems = { ...check.problems, ...serverProblems };
  const complete = Object.keys(check.missing).length === 0;
  const errors = submitted ? problems : {};

  const set = (patch: Partial<Values>) => { setValues((v) => ({ ...v, ...patch })); setServerProblems({}); setRepeat(null); };
  const dirty = (Object.keys(start) as (keyof Values)[]).filter((k) => JSON.stringify(values[k]) !== JSON.stringify(start[k])).length
    + (lost !== (Boolean(expense?.lostReason) || startLost) ? 1 : 0);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setServerError('');
    try {
      const data = file.type === 'application/pdf' ? await fileToBase64(file) : await compressImage(file);
      const { url } = await upload(data);
      set({ receiptUrl: url });
      setLost(false);
    } catch (err) {
      setServerError((err as Error).message || 'Could not upload the receipt. Try again.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
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
    if (first) { goToField(first); return; }
    setSaving(true);
    setServerError('');
    try {
      await onSave({ ...body, ...(confirmRepeat ? { confirmRepeat: true } : {}) });
    } catch (err) {
      const e = err as Error & { problems?: ExpenseProblems; repeat?: { merchant: string; date: string; cents: number } | null };
      setServerProblems(e.problems && typeof e.problems === 'object' ? e.problems : {});
      setRepeat(e.repeat || null);
      setServerError(e.message);
      setSaving(false);
    }
  };

  const categoryOptions: FormOption[] = offered.map((c) => ({ value: c.name, label: c.active ? c.label : `${c.label} (hidden)`, keywords: c.label }));
  const customerOptions = useMemo(() => customers.options.map((o) => ({ value: o.value, label: o.label, description: o.description, keywords: o.keywords })), [customers.options]);
  const missing = missingLine(check.missing);
  const footerNote = complete ? 'Goes to your approver when it’s saved.' : missing ? `Saves as a draft. Still to do: ${missing.toLowerCase()}.` : null;

  return (
    <FormModal
      title={editing ? <>Edit receipt <span className="fm-title-sub">· {expense?.merchant}</span></> : <>Add receipt <span className="fm-title-sub">· {cardLabel}</span></>}
      size="m"
      onClose={onClose}
      onSubmit={() => submit(false)}
      submitLabel={complete ? 'Send for approval' : 'Save draft'}
      saving={saving}
      submitDisabled={uploading || (editing && !dirty)}
      dirtyCount={dirty}
      discardTitle={editing ? 'Discard your changes?' : 'Discard this receipt?'}
      errors={errors}
      showErrors={submitted}
      fieldLabels={LABELS}
      footerNote={footerNote}
    >
      {serverError ? (
        <div className="ccr-form-error" role="alert">
          {repeat
            ? <>You already saved {repeat.merchant}, {formatMoney(repeat.cents)} on {usDate(repeat.date)}. Is this a second purchase?
              <button type="button" className="fm-btn fm-btn-small" onClick={() => submit(true)} disabled={saving}>Save anyway</button></>
            : serverError}
        </div>
      ) : null}

      <FormSection>
        {!lost ? (
          <FormField name="receipt" id="ccr-file-btn" label="Receipt" error={errors.receipt}>
            <div className="ccr-photo">
              {values.receiptUrl
                ? (isPdfUrl(values.receiptUrl) ? <span className="ccr-photo-pdf">PDF</span> : <img src={values.receiptUrl} alt="The receipt" />)
                : <span className="ccr-photo-pdf" aria-hidden="true"><Camera size={22} /></span>}
              <div className="ccr-photo-side">
                <span className="ccr-sub">{uploading ? 'Uploading…' : values.receiptUrl ? 'Uploaded.' : 'A photo of the receipt, or the emailed PDF.'}</span>
                <div className="ccr-photo-btns">
                  <button id="ccr-file-btn" type="button" className="fm-btn fm-btn-small" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    {values.receiptUrl ? 'Replace' : 'Take photo or choose file'}
                  </button>
                  <button type="button" className="ccr-textbtn" onClick={() => setLost(true)} disabled={uploading}>I lost the receipt</button>
                </div>
              </div>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
            </div>
          </FormField>
        ) : (
          <FormField name="lostReason" id="ccr-lost" label="Why there’s no receipt" required error={errors.lostReason || errors.receipt}>
            <textarea id="ccr-lost" className="fm-input fm-textarea" rows={3} maxLength={500} autoCapitalize="sentences"
              value={values.lostReason} onChange={(e) => set({ lostReason: e.target.value })} />
            <button type="button" className="ccr-textbtn" style={{ marginTop: 6 }} onClick={() => setLost(false)}>Found it? Upload the receipt instead</button>
          </FormField>
        )}
      </FormSection>

      <FormSection>
        <FormRow>
          <FormField name="date" id="ccr-date" label="Date" required error={errors.date}>
            <DatePicker id="ccr-date" value={values.date} max={today} today={today} onChange={(d) => set({ date: d })} error={errors.date} sheetTitle="Date" />
          </FormField>
          <FormField name="total" id="ccr-total" label="Total" required error={errors.total}>
            <div className="ccr-money"><span aria-hidden="true">$</span>
              <input id="ccr-total" className="fm-input" inputMode="decimal" autoComplete="off" placeholder="0.00" value={values.total} onChange={(e) => set({ total: e.target.value })} />
            </div>
          </FormField>
        </FormRow>
        <FormField name="merchant" id="ccr-merchant" label="Merchant" required error={errors.merchant}>
          <input id="ccr-merchant" className="fm-input" autoComplete="off" maxLength={80} placeholder="Where you paid" value={values.merchant} onChange={(e) => set({ merchant: e.target.value })} />
        </FormField>
        <div className="ccr-row-3">
          {(['subtotal', 'tax', 'tip'] as const).map((k) => (
            <FormField key={k} name={k} id={`ccr-${k}`} label={LABELS[k]} error={errors[k]}>
              <div className="ccr-money"><span aria-hidden="true">$</span>
                <input id={`ccr-${k}`} className="fm-input" inputMode="decimal" autoComplete="off" placeholder="0.00" value={values[k]} onChange={(e) => set({ [k]: e.target.value })} />
              </div>
            </FormField>
          ))}
        </div>
      </FormSection>

      <FormSection>
        <FormField name="category" id="ccr-category" label="Category" required error={errors.category || (submitted ? check.missing.category : '')}>
          <FormPicker id="ccr-category" value={values.category} onChange={(c) => set({ category: c })} options={categoryOptions}
            placeholder="Choose a category" sheetTitle="Category" error={errors.category} keepInForm />
        </FormField>
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
    </FormModal>
  );
}
