import { useMemo, useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormField, FormPicker, FormRow, FormSearchPicker, FormSection, SegmentedToggle } from '../../../components/shared/form/FormControls';
import { goToField } from '../../../components/shared/form/formFocus';
import { cleanSupplier } from '../../../utils/supplierBlocks';
import type { SupplierBody } from '../suppliersApi';
import type { Meta, SupplierRow } from '../types';

const LABELS = { name: 'Name', spsName: 'Name in SPS', language: 'Language', timeZone: 'Time zone', email: 'Email' };
const blank: SupplierBody = { name: '', spsName: '', country: '', language: 'en', timeZone: '', contactName: '', email: '', phone: '', notes: '', active: true };

/**
 * Add / Edit supplier (the form template). The name in SPS is how a PO from
 * the SPS import finds it; the country starts the language and time zone,
 * which the supplier's emails and the reviewers' "their time" follow.
 */
export default function SupplierForm({ supplier, meta, onSave, onClose }: { supplier?: SupplierRow | null; meta: Meta; onSave: (body: SupplierBody) => Promise<unknown>; onClose: () => void }) {
  const editing = Boolean(supplier);
  const start = useMemo<SupplierBody>(() => (supplier ? {
    name: supplier.name, spsName: supplier.spsName, country: supplier.country, language: supplier.language, timeZone: supplier.timeZone,
    contactName: supplier.contactName, email: supplier.email, phone: supplier.phone, notes: supplier.notes, active: supplier.active
  } : blank), [supplier]);
  const [v, setV] = useState<SupplierBody>(start);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const [serverProblems, setServerProblems] = useState<Record<string, string>>({});
  const set = (patch: Partial<SupplierBody>) => { setV((x) => ({ ...x, ...patch })); setServerProblems({}); setServerError(''); };
  const check = cleanSupplier(v, meta.languages.map((l) => l.code));
  const problems = { ...check.problems, ...serverProblems };
  const errors = submitted ? problems : {};
  const dirty = (Object.keys(start) as (keyof SupplierBody)[]).filter((k) => start[k] !== v[k]).length;

  const pickCountry = (name: string) => {
    const c = meta.countries.find((x) => x.name === name);
    const was = meta.countries.find((x) => x.name === v.country);
    // The language and zone follow the country unless someone changed them.
    const keepLang = v.language !== (was?.language || 'en') && v.language !== 'en';
    const keepZone = Boolean(v.timeZone) && v.timeZone !== was?.timeZone;
    set({ country: name, ...(c && !keepLang ? { language: c.language } : {}), ...(c && !keepZone ? { timeZone: c.timeZone } : {}) });
  };
  const zones = [...new Set([...meta.countries.map((c) => c.timeZone), v.timeZone].filter(Boolean))].sort();

  const submit = async () => {
    setSubmitted(true);
    const first = (Object.keys(LABELS) as (keyof typeof LABELS)[]).find((k) => problems[k]);
    if (first) { goToField(first); return; }
    setSaving(true);
    try { await onSave(v); } catch (err) {
      const e = err as Error & { problems?: Record<string, string> };
      setServerProblems(e.problems || {});
      setServerError(e.message);
      setSaving(false);
    }
  };

  return (
    <FormModal title={editing ? <>Edit supplier <span className="fm-title-sub">· {supplier!.name}</span></> : 'Add supplier'} size="m" onClose={onClose} onSubmit={submit}
      submitLabel={editing ? 'Save changes' : 'Add supplier'} saving={saving} submitDisabled={editing && !dirty} dirtyCount={dirty}
      errors={errors} showErrors={submitted} fieldLabels={LABELS}>
      {serverError ? <div className="sp-form-error" role="alert">{serverError}</div> : null}
      <FormSection>
        <FormRow>
          <FormField name="name" id="sup-name" label="Name" required error={errors.name}>
            <input id="sup-name" className="fm-input" value={v.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
          </FormField>
          <FormField name="spsName" id="sup-sps" label="Name in SPS" error={errors.spsName} status="How a PO from the SPS import finds them">
            <input id="sup-sps" className="fm-input" value={v.spsName} maxLength={80} onChange={(e) => set({ spsName: e.target.value })} />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField name="country" id="sup-country" label="Country">
            <FormSearchPicker id="sup-country" value={v.country} onChange={pickCountry} sheetTitle="Country" searchPlaceholder="Type a country" keepInForm
              options={meta.countries.map((c) => ({ value: c.name, label: c.name }))} selectedLabel={v.country}
              onCreateNew={(typed) => set({ country: typed.trim() })} createNewLabel={(typed) => (typed.trim() ? `Use “${typed.trim()}”` : null)} />
          </FormField>
          <FormField name="language" id="sup-lang" label="Language" error={errors.language} status="Their portal and emails">
            <FormPicker id="sup-lang" value={v.language} onChange={(language) => set({ language })} sheetTitle="Language" keepInForm
              options={meta.languages.map((l) => ({ value: l.code, label: l.code === 'en' ? 'English' : `${l.english} · ${l.name}` }))} />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField name="timeZone" id="sup-tz" label="Time zone" error={errors.timeZone}>
            <FormPicker id="sup-tz" value={v.timeZone} onChange={(timeZone) => set({ timeZone })} sheetTitle="Time zone" keepInForm placeholder="—"
              options={[{ value: '', label: '—' }, ...zones.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))]} />
          </FormField>
          <FormField name="contactName" id="sup-contact" label="Contact">
            <input id="sup-contact" className="fm-input" value={v.contactName} maxLength={80} onChange={(e) => set({ contactName: e.target.value })} />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField name="email" id="sup-email" label="Email" error={errors.email}>
            <input id="sup-email" className="fm-input no-capitalize" type="email" value={v.email} maxLength={120} onChange={(e) => set({ email: e.target.value })} />
          </FormField>
          <FormField name="phone" id="sup-phone" label="Phone">
            <input id="sup-phone" className="fm-input" type="tel" value={v.phone} maxLength={40} onChange={(e) => set({ phone: e.target.value })} />
          </FormField>
        </FormRow>
        <FormField name="notes" id="sup-notes" label="Notes">
          <textarea id="sup-notes" className="fm-input fm-textarea" rows={2} maxLength={1000} value={v.notes} onChange={(e) => set({ notes: e.target.value })} />
        </FormField>
        {editing ? (
          <FormField name="active" id="sup-active" label="Status" status={v.active ? null : 'Inactive: no new POs, and their login can’t sign in'}>
            <SegmentedToggle label="Status" value={v.active} onChange={(active) => set({ active })} options={[{ value: true, label: 'Active' }, { value: false, label: 'Inactive' }]} />
          </FormField>
        ) : null}
      </FormSection>
    </FormModal>
  );
}
