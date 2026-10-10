import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, AlertTriangle } from 'lucide-react';
import FormModal from '../../shared/form/FormModal';
import { FormSection, FormRow, FormField, FormPicker } from '../../shared/form/FormControls';
import { goToField } from '../../shared/form/formFocus';
import { PAYMENT_TERMS } from '../../../accounting/freightRules';
import { toCents, centsToPlain, formatCents, sumCents } from '../../../accounting/money';
import { todayIso, shortDate } from '../../../utils/freightView';
import { listCharges } from '../../../api/freight';

const LABELS = { carrierId: 'Carrier', invoiceNumber: 'Invoice #', invoiceDate: 'Invoice date', total: 'Invoice total', chargeIds: 'Charges' };
const ORDER = Object.keys(LABELS);

/**
 * Enter (or correct) a carrier invoice for a carrier paid per invoice: its
 * number, date and total, and which of the carrier's waiting charges it
 * covers. It can be saved when the total doesn't match yet; approving it
 * needs the two to agree to the cent (the server checks).
 */
export default function InvoiceForm({ invoice = null, carriers = [], carrierId: presetCarrier = '', onSave, onClose }) {
  const isEdit = Boolean(invoice);
  const initial = useMemo(() => ({
    carrierId: invoice ? String(invoice.carrierId) : presetCarrier,
    invoiceNumber: invoice?.invoiceNumber || '',
    invoiceDate: invoice?.invoiceDate || todayIso(),
    total: invoice ? centsToPlain(invoice.totalCents) : '',
    chargeIds: (invoice?.charges || []).map((c) => String(c._id)).sort().join(','),
    notes: invoice?.notes || ''
  }), [invoice, presetCarrier]);
  const [values, setValues] = useState(initial);
  const [picked, setPicked] = useState(() => new Set((invoice?.charges || []).map((c) => String(c._id))));
  // The carrier's charges still waiting for approval, not on another
  // invoice — loaded per carrier; set only from the request's answer.
  const [loaded, setLoaded] = useState({ carrierId: '', items: [], error: '' });
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const set = (patch) => setValues((v) => ({ ...v, ...patch }));

  useEffect(() => {
    if (!values.carrierId) return undefined;
    let live = true;
    const forCarrier = values.carrierId;
    listCharges({ status: 'draft', carrierId: forCarrier, limit: 100 })
      .then((r) => {
        if (!live) return;
        const mine = (invoice?.charges || []);
        const free = r.items.filter((c) => !c.invoiceId || String(c.invoiceId) === String(invoice?._id || ''));
        const byId = new Map([...mine, ...free].map((c) => [String(c._id), c]));
        setLoaded({ carrierId: forCarrier, items: [...byId.values()].sort((a, b) => String(b.deliveryDate).localeCompare(String(a.deliveryDate))), error: '' });
        // A new invoice starts with all of them ticked: usually the bill covers them all.
        if (!isEdit) setPicked(new Set(free.map((c) => String(c._id))));
      })
      .catch((err) => live && setLoaded({ carrierId: forCarrier, items: [], error: err.message }));
    return () => { live = false; };
  }, [values.carrierId, invoice, isEdit]);

  const current = loaded.carrierId === values.carrierId;
  const available = values.carrierId ? (current ? loaded.items : (invoice?.charges || [])) : [];
  const loadError = values.carrierId && current ? loaded.error : '';

  const chargeIds = [...picked].sort().join(',');
  const totalCents = toCents(values.total);
  const pickedCharges = available.filter((c) => picked.has(String(c._id)));
  const pickedCents = sumCents(pickedCharges.map((c) => c.amountCents));
  const noPrice = pickedCharges.filter((c) => !(c.amountCents > 0));

  const errors = {
    carrierId: values.carrierId ? '' : 'Pick the carrier.',
    invoiceNumber: values.invoiceNumber.trim() ? '' : 'Enter the invoice number.',
    invoiceDate: /^\d{4}-\d{2}-\d{2}$/.test(values.invoiceDate) ? '' : 'Pick the invoice date.',
    total: totalCents === undefined || totalCents === null || totalCents <= 0 ? 'Enter the total like 1340.00.' : '',
    chargeIds: picked.size ? '' : 'Tick at least one charge.'
  };
  const shown = (k) => (submitted ? errors[k] : '');
  const changed = ['carrierId', 'invoiceNumber', 'invoiceDate', 'total', 'notes'].filter((k) => values[k] !== initial[k])
    .concat(chargeIds !== initial.chargeIds ? ['chargeIds'] : []);

  const carrierOptions = carriers
    .filter((c) => c.paymentTerms === PAYMENT_TERMS.PER_INVOICE && (c.active !== false || String(c._id) === initial.carrierId))
    .map((c) => ({ value: String(c._id), label: c.name }));

  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = available.length > 0 && available.every((c) => picked.has(String(c._id)));

  const submit = async () => {
    setSubmitted(true);
    const first = ORDER.find((k) => errors[k]);
    if (first) { goToField(first); return; }
    setSaving(true);
    setServerError('');
    try {
      if (isEdit) {
        const body = {};
        if (changed.includes('invoiceNumber')) body.invoiceNumber = values.invoiceNumber.trim();
        if (changed.includes('invoiceDate')) body.invoiceDate = values.invoiceDate;
        if (changed.includes('total')) body.total = values.total;
        if (changed.includes('notes')) body.notes = values.notes.trim();
        if (changed.includes('chargeIds')) body.chargeIds = [...picked];
        await onSave(body);
      } else {
        await onSave({ carrierId: values.carrierId, invoiceNumber: values.invoiceNumber.trim(), invoiceDate: values.invoiceDate,
          total: values.total, chargeIds: [...picked], notes: values.notes.trim() });
      }
    } catch (err) {
      setServerError(err.message);
      setSaving(false);
    }
  };

  const gap = totalCents > 0 ? totalCents - pickedCents : null;

  return (
    <FormModal
      title={isEdit ? <>Edit invoice <span className="fm-title-sub">· #{invoice.invoiceNumber}</span></> : 'Enter carrier invoice'}
      size="m"
      onClose={onClose}
      onSubmit={submit}
      submitLabel={isEdit ? 'Save changes' : 'Save invoice'}
      saving={saving}
      submitDisabled={isEdit && changed.length === 0}
      dirtyCount={changed.length}
      discardTitle={isEdit ? 'Discard your changes?' : 'Discard this invoice?'}
      errors={Object.fromEntries(Object.entries(errors).filter(([, v]) => v))}
      showErrors={submitted}
      fieldLabels={LABELS}
    >
      {serverError ? <div className="fr-form-note err" role="alert"><AlertCircle size={16} aria-hidden="true" /><span>{serverError}</span></div> : null}
      <FormSection>
        <FormRow>
          <FormField name="carrierId" id="fr-inv-carrier" label="Carrier" required error={shown('carrierId')}>
            <FormPicker id="fr-inv-carrier" value={values.carrierId} options={carrierOptions} sheetTitle="Carrier" placeholder="Pick the carrier"
              disabled={saving || isEdit} error={shown('carrierId')} onChange={(carrierId) => set({ carrierId })} />
          </FormField>
          <FormField name="invoiceNumber" id="fr-inv-number" label="Invoice #" required error={shown('invoiceNumber')}>
            <input id="fr-inv-number" className="fm-input" value={values.invoiceNumber} maxLength={60} disabled={saving} autoCapitalize="characters"
              onChange={(e) => set({ invoiceNumber: e.target.value })} />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField name="invoiceDate" id="fr-inv-date" label="Invoice date" required error={shown('invoiceDate')}>
            <input id="fr-inv-date" className="fm-input" type="date" value={values.invoiceDate} disabled={saving}
              onChange={(e) => set({ invoiceDate: e.target.value })} />
          </FormField>
          <FormField name="total" id="fr-inv-total" label="Invoice total" required error={shown('total')}>
            <input id="fr-inv-total" className="fm-input" value={values.total} inputMode="decimal" placeholder="0.00" disabled={saving}
              onChange={(e) => set({ total: e.target.value })} />
          </FormField>
        </FormRow>
      </FormSection>
      <FormSection>
        <FormField name="chargeIds" id="fr-inv-charges" label="Charges on this invoice" required error={shown('chargeIds')}>
          <div className="fr-pick-list" id="fr-inv-charges" tabIndex={-1}>
            {loadError ? <div className="fr-pick muted">{loadError}</div> : null}
            {!values.carrierId ? <div className="fr-pick muted">Pick the carrier to see its charges.</div> : null}
            {values.carrierId && !available.length && !loadError ? <div className="fr-pick muted">No charges are waiting for this carrier.</div> : null}
            {available.length > 0 ? (
              <label className="fr-pick head">
                <input type="checkbox" className="fr-chk" checked={allOn} disabled={saving}
                  onChange={() => setPicked(allOn ? new Set() : new Set(available.map((c) => String(c._id))))} />
                <span className="grow">{picked.size} of {available.length} ticked</span>
                <span>{formatCents(pickedCents)}</span>
              </label>
            ) : null}
            {available.map((c) => (
              <label className="fr-pick" key={c._id}>
                <input type="checkbox" className="fr-chk" checked={picked.has(String(c._id))} disabled={saving} onChange={() => toggle(String(c._id))} />
                <span className="muted" style={{ width: 52, flex: 'none' }}>{shortDate(c.deliveryDate)}</span>
                <span className="grow"><b>{c.soNumber || '—'}</b> · {c.customerName || 'No customer'}{c.bolNumber ? ` · ${c.bolNumber}` : ''}</span>
                <span className={c.amountCents > 0 ? '' : 'fr-miss'}>{c.amountCents > 0 ? formatCents(c.amountCents) : 'No price'}</span>
              </label>
            ))}
          </div>
        </FormField>
        {picked.size > 0 && totalCents > 0 ? (
          gap === 0 && !noPrice.length ? (
            <div className="fr-form-note ok" role="status"><Check size={16} aria-hidden="true" /><span><b>Matches.</b> Charges {formatCents(pickedCents)} · invoice total {formatCents(totalCents)}</span></div>
          ) : (
            <div className="fr-form-note warn" role="status"><AlertTriangle size={16} aria-hidden="true" /><span>
              {noPrice.length ? <><b>{noPrice.length} ticked charge{noPrice.length > 1 ? 's have' : ' has'} no price.</b> </> : null}
              {gap !== 0 ? <><b>Charges {formatCents(pickedCents)} · invoice {formatCents(totalCents)} — {formatCents(Math.abs(gap))} apart.</b> </> : null}
              It can be saved, but not approved until they match.</span></div>
          )
        ) : null}
        <FormField name="notes" id="fr-inv-notes" label="Notes">
          <textarea id="fr-inv-notes" className="fm-input" rows={2} value={values.notes} maxLength={1000} disabled={saving}
            autoCapitalize="sentences" onChange={(e) => set({ notes: e.target.value })} />
        </FormField>
      </FormSection>
    </FormModal>
  );
}
