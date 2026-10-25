import { useMemo, useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField, FormPicker, FormSearchPicker } from '../../../components/shared/form/FormControls';
import { useCustomerOptions } from '../../../api/customerOptions';
import { CHANCE_OPTIONS, detailsOf, detailsPatch } from '../../../utils/holdView';
import type { Hold, HoldLine } from '../types';
import { ServerError } from './formParts';
import { useSubmit } from './useSubmit';

/** Customer, job, chance to close, notes and slab notes. */
export default function DetailsForm({ hold, onSave, onClose }: { hold: Hold; onSave: (patch: object) => Promise<unknown>; onClose: () => void }) {
  const initial = useMemo(() => ({ ...detailsOf(hold), lineNotes: Object.fromEntries(hold.lines.map((l: HoldLine) => [l.slabKey, l.note || ''])) as Record<string, string> }), [hold]);
  const [values, setValues] = useState(initial);
  const { options: customers, loading } = useCustomerOptions();
  const { saving, serverError, submit } = useSubmit();
  const set = (patch: Partial<typeof initial>) => setValues((v) => ({ ...v, ...patch }));

  const patch = detailsPatch(hold, values);
  const lineNotes = (hold.lines as HoldLine[])
    .filter((l) => (values.lineNotes[l.slabKey] || '').trim() !== (l.note || ''))
    .map((l) => ({ slabKey: l.slabKey, note: (values.lineNotes[l.slabKey] || '').trim() }));
  const dirty = Object.keys(patch).length + lineNotes.length;

  return (
    <FormModal
      title={<>Edit hold <span className="fm-title-sub">· #{hold.number}</span></>}
      size="m"
      onClose={onClose}
      onSubmit={() => submit(() => onSave({ ...patch, ...(lineNotes.length && { lineNotes }) }))}
      submitLabel="Save"
      saving={saving}
      submitDisabled={!dirty}
      dirtyCount={dirty}
    >
      <ServerError message={serverError} />
      <FormSection>
        <FormField name="customerId" id="hd-customer" label="Customer" required>
          <FormSearchPicker id="hd-customer" value={values.customerId} onChange={(customerId: string) => set({ customerId })} options={customers}
            loading={loading && !customers.length} selectedLabel={hold.customer?.name || ''} placeholder="Search customers" sheetTitle="Customer" disabled={saving} />
        </FormField>
        <FormField name="job" id="hd-job" label="Job / reference">
          <input id="hd-job" className="fm-input" value={values.job} maxLength={200} disabled={saving} onChange={(e) => set({ job: e.target.value })} />
        </FormField>
        <FormField name="chanceToClose" id="hd-chance" label="Chance to close">
          <FormPicker id="hd-chance" value={values.chanceToClose === null ? '' : String(values.chanceToClose)} sheetTitle="Chance to close" disabled={saving}
            onChange={(v) => set({ chanceToClose: v === '' ? null : Number(v) })}
            options={[{ value: '', label: 'Not set' }, ...CHANCE_OPTIONS.map((n) => ({ value: String(n), label: `${n}%` }))]} />
        </FormField>
        <FormField name="notes" id="hd-notes" label="Internal notes">
          <textarea id="hd-notes" className="fm-input" rows={3} value={values.notes} maxLength={2000} disabled={saving} onChange={(e) => set({ notes: e.target.value })} />
        </FormField>
        <FormField name="commissionNotes" id="hd-commission" label="Commission notes">
          <textarea id="hd-commission" className="fm-input" rows={2} value={values.commissionNotes} maxLength={500} disabled={saving} onChange={(e) => set({ commissionNotes: e.target.value })} />
        </FormField>
      </FormSection>
      <FormSection title="Slab notes">
        {hold.lines.map((l: HoldLine) => (
          <FormField key={l.slabKey} name={`note-${l.slabKey}`} id={`hd-note-${l.slabKey}`} label={`${l.serial || l.slabKey} · ${l.product}`}>
            <input id={`hd-note-${l.slabKey}`} className="fm-input" value={values.lineNotes[l.slabKey] || ''} maxLength={300} disabled={saving}
              onChange={(e) => set({ lineNotes: { ...values.lineNotes, [l.slabKey]: e.target.value } })} />
          </FormField>
        ))}
      </FormSection>
    </FormModal>
  );
}
