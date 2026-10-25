import { useMemo, useState } from 'react';
import { PauseCircle, PlayCircle } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField, SegmentedToggle } from '../../../components/shared/form/FormControls';
import { goToField } from '../../../components/shared/form/formFocus';
import { PAYMENT_TERMS } from '../../../accounting/freightRules';
import { ServerError } from './formParts';
import type { Loose } from '../../../types/records';
import type { Carrier } from '../types';

const TERMS_OPTIONS = [
  { value: PAYMENT_TERMS.PER_DELIVERY, label: 'Per delivery' },
  { value: PAYMENT_TERMS.PER_INVOICE, label: 'Per invoice' }
];

/** Add / edit a carrier: its name, other spellings, and how it's paid. */
export default function CarrierForm({ carrier = null, initialName = '', canDeactivate = false, onSave, onSetActive, onClose }: {
  carrier?: Carrier | null; initialName?: string; canDeactivate?: boolean;
  onSave: (body: Loose) => Promise<unknown>; onSetActive: (active: boolean) => Promise<unknown>; onClose: () => void;
}) {
  const isEdit = Boolean(carrier);
  const initial = useMemo((): Record<string, string> => ({
    name: carrier?.name || initialName,
    aliases: (carrier?.aliases || []).join(', '),
    paymentTerms: carrier?.paymentTerms || PAYMENT_TERMS.PER_DELIVERY,
    notes: carrier?.notes || ''
  }), [carrier, initialName]);
  const [values, setValues] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const set = (patch: Record<string, string>) => setValues((v) => ({ ...v, ...patch }));
  const errors: Record<string, string> = { name: values.name.trim() ? '' : 'Enter the carrier name.' };
  const changed = Object.keys(initial).filter((k) => values[k] !== initial[k]);
  const aliasList = (s: string) => s.split(',').map((a) => a.trim()).filter(Boolean);

  const submit = async () => {
    setSubmitted(true);
    if (errors.name) { goToField('name'); return; }
    setSaving(true);
    setServerError('');
    try {
      const body = { name: values.name.trim(), aliases: aliasList(values.aliases), paymentTerms: values.paymentTerms, notes: values.notes.trim() };
      await onSave(isEdit ? Object.fromEntries(Object.entries(body).filter(([k]) => changed.includes(k))) : body);
    } catch (err) {
      setServerError((err as Error).message);
      setSaving(false);
    }
  };

  const footerStart = isEdit && canDeactivate ? (
    <button type="button" className="fm-btn fm-btn-text-danger" disabled={saving || changed.length > 0}
      title={changed.length ? 'Save or discard your changes first' : undefined}
      onClick={async () => {
        setSaving(true);
        try { await onSetActive(carrier!.active === false); } catch (err) { setServerError((err as Error).message); setSaving(false); }
      }}>
      {carrier!.active === false ? <PlayCircle size={16} aria-hidden="true" /> : <PauseCircle size={16} aria-hidden="true" />}
      {carrier!.active === false ? 'Reactivate' : 'Deactivate'}
    </button>
  ) : null;

  return (
    <FormModal
      title={isEdit ? <>Edit carrier <span className="fm-title-sub">· {carrier!.name}</span></> : 'Add a carrier'}
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
