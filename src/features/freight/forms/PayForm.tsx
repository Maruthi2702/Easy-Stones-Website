import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField, SegmentedToggle } from '../../../components/shared/form/FormControls';
import { goToField } from '../../../components/shared/form/formFocus';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import { PAYMENT_METHODS } from '../../../accounting/freightRules';
import { formatCents } from '../../../accounting/money';
import { PAYMENT_METHOD_LABELS, referenceLabel, todayIso, newRequestId } from '../freightView';
import { ServerError } from './formParts';
import { ISO, firstError } from './formRules';

/**
 * Mark paid / Approve & pay — for charges or a carrier invoice. One request
 * id for the life of the dialog: a retry after a dropped connection returns
 * the payment already recorded instead of paying twice.
 */
/** What PayForm sends: the payment's date, method, reference and its one request id. */
export type PaymentEntry = { paidOn: string; method: string; reference: string; requestId: string };

export default function PayForm({ title, kicker, cents, sub, oneStep, submitLabel, onPay, onClose }: {
  title: ReactNode; kicker: ReactNode; cents: number; sub: ReactNode; oneStep: boolean; submitLabel: ReactNode;
  onPay: (payment: PaymentEntry) => Promise<unknown>; onClose: () => void;
}) {
  const initial = useMemo((): Record<string, string> => ({ paidOn: todayIso(), method: 'check', reference: '' }), []);
  const [values, setValues] = useState(initial);
  const [requestId] = useState(newRequestId);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const set = (patch: Record<string, string>) => setValues((v) => ({ ...v, ...patch }));

  const errors: Record<string, string> = { paidOn: ISO.test(values.paidOn) ? '' : 'Pick the date it was paid.' };
  const shown = (k: string) => (submitted ? errors[k] : '');
  const dirty = ['paidOn', 'method', 'reference'].filter((k) => values[k] !== initial[k]).length;

  const submit = async () => {
    setSubmitted(true);
    const first = firstError(errors, ['paidOn']);
    if (first) { goToField(first); return; }
    setSaving(true);
    setServerError('');
    try {
      await onPay({ paidOn: values.paidOn, method: values.method, reference: values.reference.trim(), requestId });
    } catch (err) {
      setServerError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <FormModal
      title={title}
      size="s"
      onClose={onClose}
      onSubmit={submit}
      submitLabel={submitLabel}
      savingLabel="Paying…"
      saving={saving}
      dirtyCount={dirty}
      discardTitle="Close without paying?"
      errors={submitted ? Object.fromEntries(Object.entries(errors).filter(([, v]) => v)) : {}}
      showErrors={submitted}
      fieldLabels={{ paidOn: 'Paid on' }}
    >
      <ServerError message={serverError} />
      <FormSection>
        <div className="fr-form-sum">
          <div className="k">{kicker}</div>
          <div className="v">{formatCents(cents)}</div>
          {sub ? <div className="s">{sub}</div> : null}
        </div>
        {oneStep ? (
          <div className="fr-form-note info" role="note">
            <Info size={16} aria-hidden="true" />
            <span>Not approved yet. Paying approves it too, in the same step — the history shows both, under one payment ID.</span>
          </div>
        ) : null}
      </FormSection>
      <FormSection>
        <FormField name="paidOn" id="fr-paidOn" label="Paid on" required error={shown('paidOn')}>
          <DatePicker id="fr-paidOn" value={values.paidOn} disabled={saving} error={shown('paidOn')} sheetTitle="Paid on"
            onChange={(paidOn) => set({ paidOn })} />
        </FormField>
        <FormField name="method" id="fr-method" label="Method" required>
          <SegmentedToggle label="Method" value={values.method} onChange={(method) => !saving && set({ method })}
            options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} />
        </FormField>
        <FormField name="reference" id="fr-reference" label={referenceLabel(values.method)}>
          <input id="fr-reference" className="fm-input" value={values.reference} disabled={saving} maxLength={80}
            autoCapitalize="off" inputMode={values.method === 'check' ? 'numeric' : undefined}
            onChange={(e) => set({ reference: e.target.value })} />
        </FormField>
      </FormSection>
    </FormModal>
  );
}
