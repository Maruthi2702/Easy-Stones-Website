import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormField, FormPicker, FormRow, FormSearchPicker, FormSection } from '../../../components/shared/form/FormControls';
import LocationPicker from '../../../components/shared/form/LocationPicker';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import { goToField } from '../../../components/shared/form/formFocus';
import { cleanPo, poKey, type PoProblems } from '../../../utils/supplierBlocks';
import { languageEnglish } from '../../../utils/supplierI18n';
import { spsLookup, type PoBody } from '../suppliersApi';
import type { Meta, Po, SpsLookup, SupplierRow } from '../types';

type Line = { key: string; id?: string; material: string; thickness: string; finish: string; slabs: string };
type Values = { poNumber: string; supplierId: string; shipTo: string; readyBy: string; buyerId: string; lines: Line[]; note: string };

let lineKey = 0;
const blankLine = (): Line => ({ key: `n${++lineKey}`, material: '', thickness: '', finish: '', slabs: '' });
const fromPo = (po: Po): Values => ({
  poNumber: po.poNumber, supplierId: po.supplierId, shipTo: po.shipTo, readyBy: po.readyBy, buyerId: po.buyerId,
  lines: po.lines.map((l) => ({ key: l.id, id: l.id, material: l.material, thickness: l.thickness, finish: l.finish, slabs: String(l.slabs) })),
  note: po.note?.text || ''
});
const LABELS = { poNumber: 'PO #', supplierId: 'Supplier', shipTo: 'Ship to', readyBy: 'Ready to load by', lines: 'Materials' };

export type PoFormProps = {
  po?: Po | null;
  meta: Meta;
  suppliers: SupplierRow[];
  locations: unknown[];
  user: unknown;
  onSave: (body: PoBody) => Promise<unknown>;
  onOpenExisting: (id: string) => void;
  onClose: () => void;
};

/**
 * New PO / Edit PO (the form template). Typing a new PO # looks it up in the
 * SPS import: when it's there, "Fill from SPS" copies its supplier (matched
 * by SPS name), branch and materials; when the PO is already here, it says so
 * and opens it — one PO # is one PO. No prices: the supplier sees what's
 * typed here. A PO with blocks offered keeps its number and supplier.
 */
export default function PoForm({ po, meta, suppliers, locations, user, onSave, onOpenExisting, onClose }: PoFormProps) {
  const editing = Boolean(po);
  const start = useMemo<Values>(() => (po ? fromPo(po) : {
    poNumber: '', supplierId: '', shipTo: '', readyBy: '', buyerId: meta.me.id, lines: [blankLine()], note: ''
  }), [po, meta.me.id]);
  const [values, setValues] = useState<Values>(start);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const [serverProblems, setServerProblems] = useState<PoProblems>({});
  const [existingId, setExistingId] = useState('');
  const [lookup, setLookup] = useState<{ key: string; result: SpsLookup } | null>(null);
  const [source, setSource] = useState<'typed' | 'sps'>(po?.source || 'typed');
  const [notify, setNotify] = useState(true);
  const asked = useRef('');
  const locked = Boolean(po && (po.blockStages.sent || po.draftBlocks));

  const set = (patch: Partial<Values>) => { setValues((v) => ({ ...v, ...patch })); setServerProblems({}); setServerError(''); };
  const setLine = (key: string, patch: Partial<Line>) => set({ lines: values.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });

  // Look the typed PO # up in the SPS import (new POs only), once typing pauses.
  useEffect(() => {
    if (editing) return undefined;
    const key = poKey(values.poNumber);
    if (key.length < 3) return undefined;
    const timer = window.setTimeout(async () => {
      asked.current = key;
      try {
        const found = await spsLookup(key);
        if (asked.current === key) setLookup({ key, result: found });
      } catch { /* no banner: the PO can still be typed */ }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [values.poNumber, editing]);
  const sps = lookup && lookup.key === poKey(values.poNumber) ? lookup.result : null;

  const fillFromSps = () => {
    if (!sps?.found) return;
    const matchedShip = sps.location && locations.some((l) => (typeof l === 'string' ? l : (l as { name?: string }).name) === sps.location) ? sps.location : values.shipTo;
    set({
      supplierId: sps.supplierId || values.supplierId,
      shipTo: matchedShip,
      lines: (sps.lines || []).map((l) => ({ ...blankLine(), material: l.material, slabs: String(l.slabs), thickness: /3\s?cm/i.test(l.material) ? '3 cm' : /2\s?cm/i.test(l.material) ? '2 cm' : '' }))
    });
    setSource('sps');
  };

  const body: PoBody = {
    poNumber: values.poNumber, supplierId: values.supplierId, shipTo: values.shipTo, readyBy: values.readyBy, buyerId: values.buyerId,
    lines: values.lines.map((l) => ({ id: l.id, material: l.material, thickness: l.thickness, finish: l.finish, slabs: l.slabs })),
    note: values.note, source, ...(editing ? {} : { notify })
  };
  const check = cleanPo(body, { newId: () => 'x'.repeat(24) });
  const problems: PoProblems = { ...check.problems, ...serverProblems };
  const errors = submitted ? problems : {};
  const lineErrors = (key: string, i: number) => (submitted ? problems.lineProblems?.[values.lines[i]?.id || key] || problems.lineProblems?.[String(i)] || {} : {});
  const dirty = JSON.stringify(values) !== JSON.stringify(start) ? 1 : 0;

  const submit = async () => {
    setSubmitted(true);
    const first = (Object.keys(LABELS) as (keyof typeof LABELS)[]).find((k) => problems[k]);
    if (first) { goToField(first === 'lines' ? 'line-0-material' : first); return; }
    setSaving(true);
    try {
      await onSave(body);
    } catch (err) {
      const e = err as Error & { problems?: PoProblems; existingId?: string };
      setServerProblems(e.problems && typeof e.problems === 'object' ? e.problems : {});
      setExistingId(e.existingId || '');
      setServerError(e.message);
      setSaving(false);
    }
  };

  const supplier = suppliers.find((s) => s.id === values.supplierId);
  const supplierOptions = suppliers.filter((s) => s.active || s.id === values.supplierId).map((s) => ({
    value: s.id, label: s.name, description: [s.country, languageEnglish(s.language), s.logins.some((l) => l.active && l.hasPassword) ? '' : 'no login yet'].filter(Boolean).join(' · '), keywords: `${s.name} ${s.spsName} ${s.country}`
  }));
  const hasLogin = Boolean(supplier?.logins.some((l) => l.active && l.hasPassword));
  const reads = supplier && supplier.language !== 'en'
    ? (meta.translation ? `${supplier.name} reads it in ${languageEnglish(supplier.language)} (translated automatically).` : `${supplier.name} reads ${languageEnglish(supplier.language)} — translation isn’t switched on, so write it simply.`)
    : null;
  const thicknessOptions = [{ value: '', label: '—' }, ...meta.thicknesses.map((x) => ({ value: x, label: x }))];
  const finishOptions = [{ value: '', label: '—' }, ...meta.finishes.map((x) => ({ value: x, label: x }))];
  const totalSlabs = values.lines.reduce((s, l) => s + (Number(l.slabs) || 0), 0);

  return (
    <FormModal
      title={editing ? <>Edit PO <span className="fm-title-sub">· {po!.poNumber}</span></> : 'New PO'}
      size="l"
      onClose={onClose}
      onSubmit={submit}
      submitLabel={editing ? 'Save changes' : notify && hasLogin ? 'Save and send to supplier' : 'Save and assign'}
      saving={saving}
      submitDisabled={editing && !dirty}
      dirtyCount={dirty}
      discardTitle={editing ? 'Discard your changes?' : 'Discard this PO?'}
      errors={errors}
      showErrors={submitted}
      fieldLabels={LABELS}
      footerNote={totalSlabs ? `${values.lines.length} material${values.lines.length === 1 ? '' : 's'} · ${totalSlabs} slabs` : null}
    >
      {serverError ? (
        <div className="sp-form-error" role="alert">
          {serverError}
          {existingId ? <button type="button" className="fm-btn fm-btn-small" onClick={() => onOpenExisting(existingId)}>Open it</button> : null}
        </div>
      ) : null}

      {!editing && sps?.existingId ? (
        <div className="sp-banner is-warn">PO {poKey(values.poNumber)} is already here. <button type="button" className="sp-link" onClick={() => onOpenExisting(sps.existingId!)}>Open it</button></div>
      ) : !editing && sps?.found ? (
        <div className="sp-banner is-info">
          <span>
            <b>PO {sps.poNumber} is in the SPS import</b>: {(sps.lines || []).map((l) => `${l.material} · ${l.slabs} slabs`).join('; ')}
            {sps.supplierName ? <> · from {sps.supplierName}{sps.supplierId ? '' : ' (no supplier here has that SPS name yet)'}</> : null}
            {sps.location ? ` · ${sps.location}` : ''}
          </span>
          <button type="button" className="fm-btn fm-btn-small" onClick={fillFromSps}>{source === 'sps' ? 'Filled ✓' : 'Fill from SPS'}</button>
        </div>
      ) : null}

      <FormSection number={1} title="The PO">
        <FormRow>
          <FormField name="poNumber" id="poNumber" label="PO #" required error={errors.poNumber} status={locked ? 'Blocks were offered, so it stays' : null}>
            <input id="poNumber" className="fm-input no-capitalize" value={values.poNumber} disabled={locked} maxLength={30} autoComplete="off"
              onChange={(e) => { set({ poNumber: e.target.value }); setSource('typed'); }} />
          </FormField>
          <FormField name="supplierId" id="supplierId" label="Supplier" required error={errors.supplierId}>
            <FormSearchPicker id="supplierId" value={values.supplierId} onChange={(supplierId) => set({ supplierId })} options={supplierOptions}
              placeholder={suppliers.length ? 'Choose the supplier' : 'Add a supplier first (Suppliers tab)'} searchPlaceholder="Type a supplier" sheetTitle="Supplier"
              error={errors.supplierId} disabled={locked} keepInForm />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField name="shipTo" id="shipTo" label="Ship to" required error={errors.shipTo}>
            <LocationPicker id="shipTo" value={values.shipTo} onChange={(shipTo) => set({ shipTo })} options={locations} user={user as never} error={errors.shipTo} sheetTitle="Ship to" />
          </FormField>
          <FormField name="readyBy" id="readyBy" label="Ready to load by" error={errors.readyBy}>
            <DatePicker id="readyBy" value={values.readyBy} onChange={(readyBy) => set({ readyBy })} today={meta.today} clearable error={errors.readyBy} sheetTitle="Ready to load by" />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField name="buyerId" id="buyerId" label="Buyer">
            <FormPicker id="buyerId" value={values.buyerId} onChange={(buyerId) => set({ buyerId })} sheetTitle="Buyer" keepInForm
              options={[...meta.buyers, ...(meta.buyers.some((b) => b.id === meta.me.id) ? [] : [{ id: meta.me.id, name: meta.me.name }])]
                .map((b) => ({ value: b.id, label: b.id === meta.me.id ? `${b.name} (you)` : b.name }))} />
          </FormField>
          <div />
        </FormRow>
      </FormSection>

      <FormSection number={2} title="Materials">
        <div className="sp-lines" id="lines">
          <div className="sp-line is-head" aria-hidden="true"><span>Material</span><span>Thickness</span><span>Finish</span><span>Slabs</span><span /></div>
          {values.lines.map((l, i) => {
            const le = lineErrors(l.key, i);
            return (
              <div key={l.key} className="sp-line">
                <div className="fm-field" data-field={`line-${i}-material`}>
                  <input id={`line-${i}-material`} className={`fm-input${le.material ? ' is-error' : ''}`} value={l.material} maxLength={80} aria-label={`Material ${i + 1}`}
                    placeholder="e.g. Taj Mahal Quartzite" onChange={(e) => setLine(l.key, { material: e.target.value })} />
                  {le.material ? <span className="fm-error">{le.material}</span> : null}
                </div>
                <FormPicker id={`line-${i}-th`} value={l.thickness} onChange={(thickness) => setLine(l.key, { thickness })} options={thicknessOptions} placeholder="—" sheetTitle="Thickness" keepInForm />
                <FormPicker id={`line-${i}-fi`} value={l.finish} onChange={(finish) => setLine(l.key, { finish })} options={finishOptions} placeholder="—" sheetTitle="Finish" keepInForm />
                <div className="fm-field">
                  <input id={`line-${i}-slabs`} className={`fm-input sp-num${le.slabs ? ' is-error' : ''}`} inputMode="numeric" value={l.slabs} aria-label={`Slabs ${i + 1}`}
                    onChange={(e) => setLine(l.key, { slabs: e.target.value.replace(/[^\d]/g, '') })} />
                  {le.slabs ? <span className="fm-error">{le.slabs}</span> : null}
                </div>
                <button type="button" className="sp-iconbtn" aria-label={`Remove ${l.material || `material ${i + 1}`}`} disabled={values.lines.length === 1}
                  onClick={() => set({ lines: values.lines.filter((x) => x.key !== l.key) })}><Trash2 size={16} /></button>
              </div>
            );
          })}
          {errors.lines && !problems.lineProblems ? <span className="fm-error">{errors.lines}</span> : null}
          <button type="button" className="sp-textbtn" onClick={() => set({ lines: [...values.lines, blankLine()] })}><Plus size={15} /> Add a material</button>
        </div>
      </FormSection>

      <FormSection number={3} title="For the supplier">
        <FormField name="note" id="note" label="Note to the supplier" status={reads}>
          <textarea id="note" className="fm-input fm-textarea" rows={3} maxLength={1500} autoCapitalize="sentences" value={values.note}
            placeholder="e.g. Wet the slabs for the photos. Bookmatched bundles only." onChange={(e) => set({ note: e.target.value })} />
        </FormField>
        {!editing ? (
          <label className="sp-check">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={!hasLogin} />
            {supplier ? (hasLogin ? `Email ${supplier.name} that the PO is waiting for them` : `${supplier.name} has no login set up yet — they’ll see it once they sign in`) : 'Email the supplier that the PO is waiting for them'}
          </label>
        ) : null}
      </FormSection>
    </FormModal>
  );
}
