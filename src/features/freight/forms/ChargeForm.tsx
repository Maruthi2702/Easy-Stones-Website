import { useMemo, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormRow, FormField, FormPicker } from '../../../components/shared/form/FormControls';
import { goToField } from '../../../components/shared/form/formFocus';
import LocationPicker from '../../../components/shared/form/LocationPicker';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import useTouched from '../../../components/shared/form/useTouched';
import { PAYMENT_TERMS } from '../../../accounting/freightRules';
import { toCents, centsToPlain } from '../../../accounting/money';
import { todayIso } from '../freightView';
import { ServerError } from './formParts';
import { ISO, firstError } from './formRules';
import type { Loose } from '../../../types/records';
import type { Carrier, FreightCharge, FreightUser } from '../types';

const CHARGE_LABELS: Record<string, string> = {
  location: 'Branch', deliveryDate: 'Date', carrierId: 'Carrier', amount: 'Amount', description: 'What it’s for',
  soNumber: 'SO#', customerName: 'Customer', bolNumber: 'BOL #', notes: 'Notes'
};
const CHARGE_ORDER = Object.keys(CHARGE_LABELS);

const chargeValues = (c: Loose = {}, defaults: { location?: string } = {}): Record<string, string> => ({
  location: c.location || defaults.location || '',
  deliveryDate: c.deliveryDate || todayIso(),
  carrierId: c.carrierId ? String(c.carrierId) : (c.carrier?._id ? String(c.carrier._id) : ''),
  amount: c.amountCents !== undefined && c.amountCents !== null ? centsToPlain(c.amountCents) : '',
  description: c.description || '',
  soNumber: c.soNumber || '',
  customerName: c.customerName || '',
  bolNumber: c.bolNumber || '',
  notes: c.notes || ''
});

/**
 * Add a charge by hand (detention, a lumper fee — anything without a
 * delivery) or edit one waiting for approval. An edit sends only what
 * changed; on a schedule-made charge, a field corrected here stops following
 * the delivery.
 */
export default function ChargeForm({ charge = null, carriers = [], branches = [], defaultBranch = '', user = null, onSave, onClose }: {
  charge?: FreightCharge | null; carriers?: Carrier[]; branches?: string[]; defaultBranch?: string; user?: FreightUser;
  onSave: (body: Loose) => Promise<unknown>; onClose: () => void;
}) {
  const isEdit = Boolean(charge);
  const initial = useMemo(() => chargeValues(charge || {}, { location: defaultBranch }), [charge, defaultBranch]);
  const [values, setValues] = useState(initial);
  const [touched, touchField] = useTouched();
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const set = (patch: Record<string, string>) => setValues((v) => ({ ...v, ...patch }));
  const touch = (k: string) => touchField(k, values[k] !== initial[k]);

  const cents = toCents(values.amount);
  const errors: Record<string, string> = {
    location: !isEdit && !values.location ? 'Pick the branch.' : '',
    deliveryDate: ISO.test(values.deliveryDate) ? '' : 'Pick the date.',
    carrierId: !isEdit && !values.carrierId ? 'Pick the carrier.' : '',
    amount: cents === undefined ? 'Enter the amount like 1250.00.'
      : (!isEdit && !((cents as number) > 0)) ? 'Enter the amount.'
        : (cents !== null && cents <= 0) ? 'The amount has to be more than $0.' : '',
    description: !isEdit && !values.description.trim() ? 'Say what it’s for.' : ''
  };
  const shown = (k: string) => (errors[k] && (submitted || touched[k]) ? errors[k] : '');
  const changed = CHARGE_ORDER.filter((k) => values[k] !== initial[k]);

  const carrierOptions = carriers
    .filter((c) => c.active !== false || String(c._id) === initial.carrierId)
    .map((c) => ({ value: String(c._id), label: c.name, description: c.paymentTerms === PAYMENT_TERMS.PER_INVOICE ? 'Paid per invoice' : 'Paid per delivery' }));

  const submit = async () => {
    setSubmitted(true);
    const first = firstError(errors, CHARGE_ORDER);
    if (first) { goToField(first); return; }
    setSaving(true);
    setServerError('');
    try {
      if (isEdit) {
        const body: Loose = {};
        for (const k of changed) {
          if (k === 'amount') body.amount = values.amount.trim() === '' ? null : values.amount;
          else if (k === 'carrierId') body.carrierId = values.carrierId || null;
          else if (k !== 'location') body[k] = values[k].trim();
        }
        await onSave(body);
      } else {
        await onSave({
          location: values.location, deliveryDate: values.deliveryDate, carrierId: values.carrierId,
          amount: values.amount, description: values.description.trim(), soNumber: values.soNumber.trim(),
          customerName: values.customerName.trim(), bolNumber: values.bolNumber.trim(), notes: values.notes.trim()
        });
      }
    } catch (err) {
      setServerError((err as Error).message);
      setSaving(false);
    }
  };

  const text = (k: string, { required = false, ...rest }: { required?: boolean } & InputHTMLAttributes<HTMLInputElement> = {}) => (
    <FormField name={k} id={`fr-${k}`} label={CHARGE_LABELS[k]} required={required} error={shown(k)}>
      <input id={`fr-${k}`} className="fm-input" value={values[k]} disabled={saving}
        onChange={(e) => set({ [k]: e.target.value })} onBlur={() => touch(k)} {...rest} />
    </FormField>
  );
  const showDescription = !isEdit || charge!.source === 'manual' || charge!.description;

  return (
    <FormModal
      title={isEdit ? <>Edit charge <span className="fm-title-sub">· SO# {charge!.soNumber || '—'}</span></> : 'Add a charge'}
      size="m"
      onClose={onClose}
      onSubmit={submit}
      submitLabel={isEdit ? 'Save changes' : 'Add charge'}
      saving={saving}
      submitDisabled={isEdit && changed.length === 0}
      dirtyCount={changed.length}
      discardTitle={isEdit ? 'Discard your changes?' : 'Discard this charge?'}
      errors={Object.fromEntries(Object.entries(errors).filter(([, v]) => v))}
      showErrors={submitted}
      fieldLabels={CHARGE_LABELS}
    >
      <ServerError message={serverError} />
      <FormSection>
        {!isEdit ? (
          <FormRow>
            <FormField name="location" id="fr-location" label="Branch" required error={shown('location')}>
              <LocationPicker id="fr-location" value={values.location || ''} options={branches} user={user} sheetTitle="Branch"
                placeholder="Choose a branch" disabled={saving} error={shown('location')} onChange={(location) => set({ location })} />
            </FormField>
            <FormField name="deliveryDate" id="fr-deliveryDate" label="Date" required error={shown('deliveryDate')}>
              <DatePicker id="fr-deliveryDate" value={values.deliveryDate} disabled={saving} error={shown('deliveryDate')} sheetTitle="Date"
                onChange={(deliveryDate) => set({ deliveryDate })} onBlur={() => touch('deliveryDate')} />
            </FormField>
          </FormRow>
        ) : null}
        <FormRow>
          <FormField name="carrierId" id="fr-carrierId" label="Carrier" required={!isEdit} error={shown('carrierId')}>
            <FormPicker id="fr-carrierId" value={values.carrierId} options={carrierOptions} sheetTitle="Carrier" placeholder="Pick the carrier"
              disabled={saving} error={shown('carrierId')} onChange={(carrierId) => set({ carrierId })} />
          </FormField>
          {text('amount', { required: !isEdit, inputMode: 'decimal', placeholder: '0.00', autoCapitalize: 'off' })}
        </FormRow>
        {isEdit ? (
          <FormRow>
            <FormField name="deliveryDate" id="fr-deliveryDate" label="Date" error={shown('deliveryDate')}>
              <DatePicker id="fr-deliveryDate" value={values.deliveryDate} disabled={saving} error={shown('deliveryDate')} sheetTitle="Date"
                onChange={(deliveryDate) => set({ deliveryDate })} onBlur={() => touch('deliveryDate')} />
            </FormField>
            {text('bolNumber', { autoCapitalize: 'characters' })}
          </FormRow>
        ) : null}
        {showDescription ? text('description', { required: !isEdit, maxLength: 300, autoCapitalize: 'sentences', placeholder: 'Detention, lumper fee…' }) : null}
      </FormSection>
      <FormSection>
        <FormRow>
          {text('soNumber', { autoCapitalize: 'off' })}
          {!isEdit ? text('bolNumber', { autoCapitalize: 'characters' }) : text('customerName', { autoCapitalize: 'words' })}
        </FormRow>
        {!isEdit ? text('customerName', { autoCapitalize: 'words' }) : null}
        <FormField name="notes" id="fr-notes" label="Notes">
          <textarea id="fr-notes" className="fm-input" rows={3} value={values.notes} maxLength={1000} disabled={saving}
            autoCapitalize="sentences" onChange={(e) => set({ notes: e.target.value })} />
        </FormField>
      </FormSection>
    </FormModal>
  );
}
