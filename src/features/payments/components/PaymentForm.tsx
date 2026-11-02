import { useMemo, useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormRow, FormField, FormPicker, FormSearchPicker } from '../../../components/shared/form/FormControls';
import type { FormOption } from '../../../components/shared/form/FormControls';
import { goToField } from '../../../components/shared/form/formFocus';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import { useCustomerOptions } from '../../../api/customerOptions';
import { RECEIVED_METHODS, RETURN_METHOD, cleanPayment, methodOf, type PaymentProblems } from '../../../utils/paymentsReceived';
import type { PaymentBody } from '../paymentsApi';
import type { Payment } from '../types';

type Values = PaymentBody;

const blank = (date: string): Values => ({ date, customerId: '', customerName: '', method: '', amount: '', invoice: '', reference: '', note: '' });
const fromPayment = (p: Payment): Values => ({
  date: p.date, customerId: p.customerId, customerName: p.customerName, method: p.method,
  amount: (Math.abs(p.cents) / 100).toFixed(2), invoice: p.invoice, reference: p.reference, note: p.note
});

const METHOD_OPTIONS: FormOption[] = RECEIVED_METHODS.map((m) => ({
  value: m.key,
  label: (
    <span className={`pay-opt${m.key === RETURN_METHOD ? ' is-return' : ''}`}>
      <span className={`pay-dot pay-dot-${m.key}`} aria-hidden="true" />
      {m.label}
      <span className="pay-opt-hint"> · {m.hint}</span>
    </span>
  ),
  keywords: m.label
}));

const LABELS = { customer: 'Company', date: 'Date', method: 'Method', amount: 'Amount' };

export type PaymentFormProps = {
  location: string;
  /** The day on screen: a new payment starts on it. */
  date: string;
  /** The branch's own today; no payment after it. */
  today: string;
  /** Editing this payment; absent to add one. */
  payment?: Payment | null;
  onSave: (values: Values) => Promise<unknown>;
  onVoid?: () => void;
  onClose: () => void;
};

/**
 * Add / Edit payment, on the form template (FORM_TEMPLATE.md). Company, date,
 * method and amount are required; a Return's amount is saved negative
 * whatever is typed. The dropdowns keep their list inside the form
 * (`keepInForm`, owner 2026-11-02). Edit's footer has Void on the left and the
 * last change in the middle.
 */
export default function PaymentForm({ location, date, today, payment, onSave, onVoid, onClose }: PaymentFormProps) {
  const editing = Boolean(payment);
  const start = useMemo(() => (payment ? fromPayment(payment) : blank(date)), [payment, date]);
  const [values, setValues] = useState<Values>(start);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const [serverProblems, setServerProblems] = useState<PaymentProblems>({});
  const customers = useCustomerOptions();

  const set = (patch: Partial<Values>) => { setValues((v) => ({ ...v, ...patch })); setServerProblems({}); };
  const dirty = (Object.keys(start) as (keyof Values)[]).filter((k) => String(values[k]) !== String(start[k])).length;
  const problems: PaymentProblems = { ...cleanPayment(values, today).problems, ...serverProblems };
  const errors = submitted ? problems : {};
  const isReturn = values.method === RETURN_METHOD;
  const method = methodOf(values.method);

  const companyOptions = useMemo(() => customers.options.map((o) => ({
    value: o.value, label: o.label, description: o.description, keywords: o.keywords
  })), [customers.options]);

  const submit = async () => {
    setSubmitted(true);
    const first = (Object.keys(LABELS) as (keyof typeof LABELS)[]).find((k) => problems[k]);
    if (first) { goToField(first); return; }
    setSaving(true);
    setServerError('');
    try {
      await onSave(values);
    } catch (err) {
      const e = err as Error & { problems?: PaymentProblems };
      setServerProblems(e.problems && typeof e.problems === 'object' ? e.problems : {});
      setServerError(e.message);
      setSaving(false);
    }
  };

  const last = payment?.history?.[payment.history.length - 1];
  const footerNote = last
    ? `Last changed by ${last.by || 'someone'} · ${new Date(last.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
    : null;

  return (
    <FormModal
      title={editing ? <>Edit payment <span className="fm-title-sub">· {payment?.customerName}</span></> : <>Add payment <span className="fm-title-sub">· {location}</span></>}
      size="m"
      onClose={onClose}
      onSubmit={submit}
      submitLabel={editing ? 'Save changes' : 'Save payment'}
      saving={saving}
      submitDisabled={editing && !dirty}
      dirtyCount={dirty}
      discardTitle={editing ? 'Discard your changes?' : 'Discard this payment?'}
      errors={errors}
      showErrors={submitted}
      fieldLabels={LABELS}
      footerNote={footerNote}
      footerStart={editing && onVoid ? (
        <button type="button" className="fm-btn fm-btn-text-danger" onClick={onVoid} disabled={dirty > 0 || saving}
          title={dirty ? 'Save or undo your changes first' : undefined}>
          Void payment
        </button>
      ) : null}
    >
      {serverError ? <div className="pay-form-error" role="alert">{serverError}</div> : null}
      <FormSection>
        <div className="fm-row pay-row-company">
          <FormField name="customer" id="pay-company" label="Company" required error={errors.customer}>
            <FormSearchPicker
              id="pay-company"
              value={values.customerId}
              selectedLabel={values.customerName}
              onChange={(id) => {
                const o = customers.options.find((c) => c.value === id);
                set({ customerId: id, customerName: o?.label || '' });
              }}
              options={companyOptions}
              loading={customers.loading}
              placeholder="Choose a customer"
              searchPlaceholder="Search name, city or contact"
              sheetTitle="Company"
              error={errors.customer}
              keepInForm
            />
          </FormField>
          <FormField name="date" id="pay-date" label="Date" required error={errors.date}>
            <DatePicker id="pay-date" value={values.date} max={today} today={today} onChange={(d) => set({ date: d })} error={errors.date} sheetTitle="Date" />
          </FormField>
        </div>
        <FormRow>
          <FormField name="method" id="pay-method" label="Method" required error={errors.method}>
            <FormPicker id="pay-method" value={values.method} onChange={(m) => set({ method: m })} options={METHOD_OPTIONS}
              placeholder="Choose a method" sheetTitle="Method" error={errors.method} keepInForm />
          </FormField>
          <FormField name="amount" id="pay-amount" label={isReturn ? 'Return amount' : 'Amount'} required error={errors.amount}>
            <div className={`pay-money${isReturn ? ' is-return' : ''}`}>
              <span aria-hidden="true">{isReturn ? '−$' : '$'}</span>
              <input id="pay-amount" className="fm-input" inputMode="decimal" autoComplete="off" placeholder="0.00"
                value={values.amount} onChange={(e) => set({ amount: e.target.value })}
                aria-invalid={errors.amount ? true : undefined} aria-describedby={errors.amount ? 'pay-amount-msg' : undefined} />
            </div>
          </FormField>
        </FormRow>
      </FormSection>
      <FormSection>
        <FormRow>
          <FormField id="pay-invoice" label="Invoice / SO #">
            <input id="pay-invoice" className="fm-input" autoComplete="off" autoCapitalize="characters" maxLength={60}
              value={values.invoice} onChange={(e) => set({ invoice: e.target.value })} />
          </FormField>
          <FormField id="pay-reference" label={method?.reference || 'Reference'}>
            <input id="pay-reference" className="fm-input" autoComplete="off" maxLength={values.method === 'card' ? 4 : 60}
              inputMode={values.method === 'card' ? 'numeric' : undefined}
              value={values.reference} onChange={(e) => set({ reference: e.target.value })} />
          </FormField>
        </FormRow>
        <FormField id="pay-note" label="Note">
          <textarea id="pay-note" className="fm-input fm-textarea" rows={3} maxLength={500} autoCapitalize="sentences"
            value={values.note} onChange={(e) => set({ note: e.target.value })} />
        </FormField>
      </FormSection>
    </FormModal>
  );
}
