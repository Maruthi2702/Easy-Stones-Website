import React, { useMemo, useState } from 'react';
import { Info, AlertCircle, PauseCircle, PlayCircle } from 'lucide-react';
import FormModal from '../../shared/form/FormModal';
import { FormSection, FormRow, FormField, FormPicker, SegmentedToggle } from '../../shared/form/FormControls';
import { goToField } from '../../shared/form/formFocus';
import useTouched from '../../shared/form/useTouched';
import { PAYMENT_METHODS, PAYMENT_TERMS } from '../../../accounting/freightRules';
import { toCents, centsToPlain, formatCents } from '../../../accounting/money';
import { PAYMENT_METHOD_LABELS, referenceLabel, todayIso, newRequestId } from '../../../utils/freightView';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A server error, shown at the top of a form's body. */
const ServerError = ({ message }) => (message ? (
  <div className="fr-form-note err" role="alert"><AlertCircle size={16} aria-hidden="true" /><span>{message}</span></div>
) : null);

const firstError = (errors, order) => order.find((k) => errors[k]);

/**
 * Mark paid / Approve & pay — for charges or a carrier invoice. One request
 * id for the life of the dialog: a retry after a dropped connection returns
 * the payment already recorded instead of paying twice.
 */
export function PayForm({ title, kicker, cents, sub, oneStep, submitLabel, onPay, onClose }) {
  const initial = useMemo(() => ({ paidOn: todayIso(), method: 'check', reference: '' }), []);
  const [values, setValues] = useState(initial);
  const [requestId] = useState(newRequestId);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const set = (patch) => setValues((v) => ({ ...v, ...patch }));

  const errors = { paidOn: ISO.test(values.paidOn) ? '' : 'Pick the date it was paid.' };
  const shown = (k) => (submitted ? errors[k] : '');
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
      setServerError(err.message);
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
          <input id="fr-paidOn" className="fm-input" type="date" value={values.paidOn} disabled={saving}
            onChange={(e) => set({ paidOn: e.target.value })} />
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

/** Void a charge or invoice: a reason is required, and the record stays. */
export function VoidForm({ title, submitLabel, onVoid, onClose }) {
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const error = reason.trim() ? '' : 'Say why it’s being voided.';

  const submit = async () => {
    setSubmitted(true);
    if (error) { goToField('reason'); return; }
    setSaving(true);
    setServerError('');
    try { await onVoid(reason.trim()); } catch (err) { setServerError(err.message); setSaving(false); }
  };

  return (
    <FormModal
      title={title}
      size="s"
      onClose={onClose}
      onSubmit={submit}
      submitLabel={submitLabel}
      savingLabel="Voiding…"
      saving={saving}
      dirtyCount={reason.trim() ? 1 : 0}
      discardTitle="Close without voiding?"
      errors={submitted && error ? { reason: error } : {}}
      showErrors={submitted}
      fieldLabels={{ reason: 'Reason' }}
    >
      <ServerError message={serverError} />
      <FormSection>
        <FormField name="reason" id="fr-reason" label="Reason" required error={submitted ? error : ''}>
          <textarea id="fr-reason" className="fm-input" rows={3} value={reason} maxLength={300} disabled={saving}
            autoCapitalize="sentences" onChange={(e) => setReason(e.target.value)} />
        </FormField>
      </FormSection>
    </FormModal>
  );
}

const CHARGE_LABELS = {
  location: 'Branch', deliveryDate: 'Date', carrierId: 'Carrier', amount: 'Amount', description: 'What it’s for',
  soNumber: 'SO#', customerName: 'Customer', bolNumber: 'BOL #', notes: 'Notes'
};
const CHARGE_ORDER = Object.keys(CHARGE_LABELS);

const chargeValues = (c = {}, defaults = {}) => ({
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
export function ChargeForm({ charge = null, carriers = [], branches = [], defaultBranch = '', onSave, onClose }) {
  const isEdit = Boolean(charge);
  const initial = useMemo(() => chargeValues(charge || {}, { location: defaultBranch }), [charge, defaultBranch]);
  const [values, setValues] = useState(initial);
  const [touched, touchField] = useTouched();
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const set = (patch) => setValues((v) => ({ ...v, ...patch }));
  const touch = (k) => touchField(k, values[k] !== initial[k]);

  const cents = toCents(values.amount);
  const errors = {
    location: !isEdit && !values.location ? 'Pick the branch.' : '',
    deliveryDate: ISO.test(values.deliveryDate) ? '' : 'Pick the date.',
    carrierId: !isEdit && !values.carrierId ? 'Pick the carrier.' : '',
    amount: cents === undefined ? 'Enter the amount like 1250.00.'
      : (!isEdit && !(cents > 0)) ? 'Enter the amount.'
        : (cents !== null && cents <= 0) ? 'The amount has to be more than $0.' : '',
    description: !isEdit && !values.description.trim() ? 'Say what it’s for.' : ''
  };
  const shown = (k) => (errors[k] && (submitted || touched[k]) ? errors[k] : '');
  const changed = CHARGE_ORDER.filter((k) => values[k] !== initial[k]);

  const carrierOptions = carriers
    .filter((c) => c.active !== false || String(c._id) === initial.carrierId)
    .map((c) => ({ value: String(c._id), label: c.name, description: c.paymentTerms === PAYMENT_TERMS.PER_INVOICE ? 'Paid per invoice' : 'Paid per delivery' }));
  const branchOptions = branches.map((b) => ({ value: b, label: b }));

  const submit = async () => {
    setSubmitted(true);
    const first = firstError(errors, CHARGE_ORDER);
    if (first) { goToField(first); return; }
    setSaving(true);
    setServerError('');
    try {
      if (isEdit) {
        const body = {};
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
      setServerError(err.message);
      setSaving(false);
    }
  };

  const text = (k, { required = false, ...rest } = {}) => (
    <FormField name={k} id={`fr-${k}`} label={CHARGE_LABELS[k]} required={required} error={shown(k)}>
      <input id={`fr-${k}`} className="fm-input" value={values[k]} disabled={saving}
        onChange={(e) => set({ [k]: e.target.value })} onBlur={() => touch(k)} {...rest} />
    </FormField>
  );
  const showDescription = !isEdit || charge.source === 'manual' || charge.description;

  return (
    <FormModal
      title={isEdit ? <>Edit charge <span className="fm-title-sub">· SO# {charge.soNumber || '—'}</span></> : 'Add a charge'}
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
              <FormPicker id="fr-location" value={values.location} options={branchOptions} sheetTitle="Branch" disabled={saving}
                error={shown('location')} onChange={(location) => set({ location })} />
            </FormField>
            <FormField name="deliveryDate" id="fr-deliveryDate" label="Date" required error={shown('deliveryDate')}>
              <input id="fr-deliveryDate" className="fm-input" type="date" value={values.deliveryDate} disabled={saving}
                onChange={(e) => set({ deliveryDate: e.target.value })} onBlur={() => touch('deliveryDate')} />
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
              <input id="fr-deliveryDate" className="fm-input" type="date" value={values.deliveryDate} disabled={saving}
                onChange={(e) => set({ deliveryDate: e.target.value })} onBlur={() => touch('deliveryDate')} />
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

const TERMS_OPTIONS = [
  { value: PAYMENT_TERMS.PER_DELIVERY, label: 'Per delivery' },
  { value: PAYMENT_TERMS.PER_INVOICE, label: 'Per invoice' }
];

/** Add / edit a carrier: its name, other spellings, and how it's paid. */
export function CarrierForm({ carrier = null, initialName = '', canDeactivate = false, onSave, onSetActive, onClose }) {
  const isEdit = Boolean(carrier);
  const initial = useMemo(() => ({
    name: carrier?.name || initialName,
    aliases: (carrier?.aliases || []).join(', '),
    paymentTerms: carrier?.paymentTerms || PAYMENT_TERMS.PER_DELIVERY,
    notes: carrier?.notes || ''
  }), [carrier, initialName]);
  const [values, setValues] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const set = (patch) => setValues((v) => ({ ...v, ...patch }));
  const errors = { name: values.name.trim() ? '' : 'Enter the carrier name.' };
  const changed = Object.keys(initial).filter((k) => values[k] !== initial[k]);
  const aliasList = (s) => s.split(',').map((a) => a.trim()).filter(Boolean);

  const submit = async () => {
    setSubmitted(true);
    if (errors.name) { goToField('name'); return; }
    setSaving(true);
    setServerError('');
    try {
      const body = { name: values.name.trim(), aliases: aliasList(values.aliases), paymentTerms: values.paymentTerms, notes: values.notes.trim() };
      await onSave(isEdit ? Object.fromEntries(Object.entries(body).filter(([k]) => changed.includes(k))) : body);
    } catch (err) {
      setServerError(err.message);
      setSaving(false);
    }
  };

  const footerStart = isEdit && canDeactivate ? (
    <button type="button" className="fm-btn fm-btn-text-danger" disabled={saving || changed.length > 0}
      title={changed.length ? 'Save or discard your changes first' : undefined}
      onClick={async () => {
        setSaving(true);
        try { await onSetActive(carrier.active === false); } catch (err) { setServerError(err.message); setSaving(false); }
      }}>
      {carrier.active === false ? <PlayCircle size={16} aria-hidden="true" /> : <PauseCircle size={16} aria-hidden="true" />}
      {carrier.active === false ? 'Reactivate' : 'Deactivate'}
    </button>
  ) : null;

  return (
    <FormModal
      title={isEdit ? <>Edit carrier <span className="fm-title-sub">· {carrier.name}</span></> : 'Add a carrier'}
      size="s"
      onClose={onClose}
      onSubmit={submit}
      submitLabel={isEdit ? 'Save changes' : 'Add carrier'}
      saving={saving}
      submitDisabled={isEdit && changed.length === 0}
      dirtyCount={changed.length}
      errors={submitted && errors.name ? errors : {}}
      showErrors={submitted}
      fieldLabels={{ name: 'Carrier name' }}
      footerStart={footerStart}
    >
      <ServerError message={serverError} />
      <FormSection>
        <FormField name="name" id="fr-cname" label="Carrier name" required error={submitted ? errors.name : ''}>
          <input id="fr-cname" className="fm-input" value={values.name} maxLength={120} disabled={saving} autoCapitalize="words"
            onChange={(e) => set({ name: e.target.value })} />
        </FormField>
        <FormField name="aliases" id="fr-aliases" label="Other spellings (comma between)">
          <input id="fr-aliases" className="fm-input" value={values.aliases} disabled={saving} autoCapitalize="words"
            placeholder="ABC Trucking, A.B.C. Freight" onChange={(e) => set({ aliases: e.target.value })} />
        </FormField>
        <FormField name="paymentTerms" id="fr-terms" label="Paid" required>
          <SegmentedToggle label="Paid" value={values.paymentTerms} options={TERMS_OPTIONS}
            onChange={(paymentTerms) => !saving && set({ paymentTerms })} />
        </FormField>
        <FormField name="notes" id="fr-cnotes" label="Notes">
          <textarea id="fr-cnotes" className="fm-input" rows={2} value={values.notes} maxLength={1000} disabled={saving}
            autoCapitalize="sentences" onChange={(e) => set({ notes: e.target.value })} />
        </FormField>
      </FormSection>
    </FormModal>
  );
}
