import React, { useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import FormModal from '../../shared/form/FormModal';
import { FormSection, FormField, FormPicker, FormSearchPicker } from '../../shared/form/FormControls';
import { goToField } from '../../shared/form/formFocus';
import { useCustomerOptions } from '../../../api/customerOptions';
import { lotGroups, formatSf, priceCentsOf, todayIn, addDays, MAX_HOLD_DAYS } from '../../../holds/holdRules';
import { branchZone } from '../../../config/branches';
import {
  CHANCE_OPTIONS, detailsOf, detailsPatch, extendChoices, longDate, dayMonth, slabCount
} from '../../../utils/holdView';

/*
 * The Hold page's forms, on the shared template (FORM_TEMPLATE.md). Each one
 * hands its values to the page, which saves them with the hold's version and
 * closes the form; a refusal comes back here and shows at the top.
 */

const ServerError = ({ message }) => (message ? (
  <div className="hl-form-note err" role="alert"><AlertCircle size={16} aria-hidden="true" /><span>{message}</span></div>
) : null);

/** saving / server error around one submit. */
function useSubmit() {
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const submit = async (fn) => {
    setSaving(true);
    setServerError('');
    try { await fn(); } catch (err) { setServerError(err.message); setSaving(false); }
  };
  return { saving, serverError, submit };
}

/** Customer, job, chance to close, notes and slab notes. */
export function DetailsForm({ hold, onSave, onClose }) {
  const initial = useMemo(() => ({ ...detailsOf(hold), lineNotes: Object.fromEntries(hold.lines.map((l) => [l.slabKey, l.note || ''])) }), [hold]);
  const [values, setValues] = useState(initial);
  const { options: customers, loading } = useCustomerOptions();
  const { saving, serverError, submit } = useSubmit();
  const set = (patch) => setValues((v) => ({ ...v, ...patch }));

  const patch = detailsPatch(hold, values);
  const lineNotes = hold.lines
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
          <FormSearchPicker id="hd-customer" value={values.customerId} onChange={(customerId) => set({ customerId })} options={customers}
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
        {hold.lines.map((l) => (
          <FormField key={l.slabKey} name={`note-${l.slabKey}`} id={`hd-note-${l.slabKey}`} label={`${l.serial || l.slabKey} · ${l.product}`}>
            <input id={`hd-note-${l.slabKey}`} className="fm-input" value={values.lineNotes[l.slabKey] || ''} maxLength={300} disabled={saving}
              onChange={(e) => set({ lineNotes: { ...values.lineNotes, [l.slabKey]: e.target.value } })} />
          </FormField>
        ))}
      </FormSection>
    </FormModal>
  );
}

/** Move the hold date — 7, 14 or 30 days on, or any date. Needs the Extend permission. */
export function ExtendForm({ hold, onSave, onClose }) {
  const choices = useMemo(() => extendChoices(hold), [hold]);
  const today = todayIn(branchZone(hold.branch));
  const [expiresOn, setExpiresOn] = useState(choices[0].expiresOn);
  const [submitted, setSubmitted] = useState(false);
  const { saving, serverError, submit } = useSubmit();
  const latest = addDays(today, MAX_HOLD_DAYS);
  const error = !expiresOn ? 'Pick the date.' : expiresOn < today ? 'The date can’t be in the past.' : expiresOn > latest ? `A hold can run for up to ${MAX_HOLD_DAYS} days.` : '';

  return (
    <FormModal
      title={<>Extend hold <span className="fm-title-sub">· #{hold.number}</span></>}
      size="s"
      onClose={onClose}
      onSubmit={() => { setSubmitted(true); if (error) { goToField('expiresOn'); return; } submit(() => onSave(expiresOn)); }}
      submitLabel={expiresOn ? `Hold until ${dayMonth(expiresOn)}` : 'Extend'}
      saving={saving}
      dirtyCount={expiresOn !== hold.expiresOn ? 1 : 0}
      errors={submitted && error ? { expiresOn: error } : {}}
      showErrors={submitted}
      fieldLabels={{ expiresOn: 'Hold until' }}
    >
      <ServerError message={serverError} />
      <FormSection>
        <div className="hl-form-sum">
          <div className="k">Now held until</div>
          <div className="v">{longDate(hold.expiresOn)}</div>
        </div>
        <FormField name="expiresOn" id="hx-date" label="Hold until" required error={submitted ? error : ''}>
          <div className="hl-chips" role="radiogroup" aria-label="Quick picks">
            {choices.map((ch) => (
              <button key={ch.days} type="button" role="radio" aria-checked={expiresOn === ch.expiresOn} className={`hl-chip${expiresOn === ch.expiresOn ? ' on' : ''}`}
                disabled={saving} onClick={() => setExpiresOn(ch.expiresOn)}>
                +{ch.days} days · {dayMonth(ch.expiresOn)}
              </button>
            ))}
          </div>
          <input id="hx-date" className="fm-input" type="date" value={expiresOn} min={today} max={latest} disabled={saving} onChange={(e) => setExpiresOn(e.target.value)} />
        </FormField>
      </FormSection>
    </FormModal>
  );
}

const RELEASE_REASONS = ['Customer passed', 'Chose other slabs', 'Bought elsewhere', 'Duplicate hold'];

/** Release: a reason is required; the slabs are free the moment it's saved. */
export function ReleaseForm({ hold, onRelease, onClose }) {
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { saving, serverError, submit } = useSubmit();
  const error = reason.trim() ? '' : 'Say why it’s being released.';

  return (
    <FormModal
      title={<>Release hold <span className="fm-title-sub">· #{hold.number}</span></>}
      size="s"
      onClose={onClose}
      onSubmit={() => { setSubmitted(true); if (error) { goToField('reason'); return; } submit(() => onRelease(reason.trim())); }}
      submitLabel={`Release ${slabCount(hold.lines.length)}`}
      savingLabel="Releasing…"
      saving={saving}
      dirtyCount={reason.trim() ? 1 : 0}
      discardTitle="Close without releasing?"
      errors={submitted && error ? { reason: error } : {}}
      showErrors={submitted}
      fieldLabels={{ reason: 'Reason' }}
    >
      <ServerError message={serverError} />
      <FormSection>
        <div className="hl-form-sum">
          <div className="k">{hold.customer?.name}</div>
          <div className="v">{slabCount(hold.lines.length)}</div>
          <div className="s">Free for anyone to hold again once released. The hold stays on record under Released.</div>
        </div>
        <FormField name="reason" id="hr-reason" label="Reason" required error={submitted ? error : ''}>
          <div className="hl-chips">
            {RELEASE_REASONS.map((r) => (
              <button key={r} type="button" className={`hl-chip${reason === r ? ' on' : ''}`} disabled={saving} onClick={() => setReason(r)}>{r}</button>
            ))}
          </div>
          <textarea id="hr-reason" className="fm-input" rows={2} value={reason} maxLength={300} disabled={saving} onChange={(e) => setReason(e.target.value)} />
        </FormField>
      </FormSection>
    </FormModal>
  );
}

/** Swap one slab for another: scan or type it, or pick one of the same product from the cart. */
export function SwapForm({ hold, line, cartLines = [], onSwap, onClose }) {
  const [to, setTo] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { saving, serverError, submit } = useSubmit();
  const picks = cartLines.filter((l) => l.inStock && !l.lock && l.slab?.product === line.product && !hold.slabKeys.includes(l.slabKey));
  const key = to.trim().toUpperCase();
  const error = !key ? 'Scan or type the serial # to swap in.' : key === line.slabKey ? 'That’s the slab being swapped out.' : hold.slabKeys.includes(key) ? 'That slab is already on this hold.' : '';

  return (
    <FormModal
      title={<>Swap slab <span className="fm-title-sub">· {line.serial || line.slabKey}</span></>}
      size="s"
      onClose={onClose}
      onSubmit={() => { setSubmitted(true); if (error) { goToField('to'); return; } submit(() => onSwap(key)); }}
      submitLabel="Swap"
      savingLabel="Swapping…"
      saving={saving}
      dirtyCount={key ? 1 : 0}
      errors={submitted && error ? { to: error } : {}}
      showErrors={submitted}
      fieldLabels={{ to: 'Swap in' }}
    >
      <ServerError message={serverError} />
      <FormSection>
        <div className="hl-form-sum">
          <div className="k">Swapping out</div>
          <div className="v">{line.serial || line.slabKey}</div>
          <div className="s">{[line.product, line.dimensions, formatSf(line.sfHundredths)].filter(Boolean).join(' · ')} — the new slab keeps its price and note.</div>
        </div>
        <FormField name="to" id="hs-to" label="Swap in (serial #)" required error={submitted ? error : ''}>
          <input id="hs-to" className="fm-input no-capitalize" value={to} maxLength={60} autoComplete="off" disabled={saving} onChange={(e) => setTo(e.target.value)} />
        </FormField>
        {picks.length ? (
          <div className="hl-pick-list" role="radiogroup" aria-label="From your cart">
            <div className="hl-pick head">From your cart · same product</div>
            {picks.map((p) => (
              <label key={p.slabKey} className="hl-pick">
                <input type="radio" name="hs-pick" checked={key === p.slabKey} disabled={saving} onChange={() => setTo(p.slabKey)} />
                <span className="grow"><b>{p.slab?.serial || p.slabKey}</b></span>
                <span className="muted">{[p.slab?.bundle && `Bundle ${p.slab.bundle}`, formatSf(p.slab?.sfHundredths)].filter(Boolean).join(' · ')}</span>
              </label>
            ))}
          </div>
        ) : null}
      </FormSection>
    </FormModal>
  );
}

/** Add cart slabs to the hold, priced per product (prefilled from the hold's own price). */
export function AddSlabsForm({ hold, offered, onAdd, onClose }) {
  const lines = useMemo(() => offered.map((l) => ({ ...l.slab, slabKey: l.slabKey, product: l.slab?.product || '', suggestedPrice: l.suggestedPrice, note: l.note || '' })), [offered]);
  const groups = lotGroups(lines);
  const [picked, setPicked] = useState(() => new Set(lines.map((l) => l.slabKey)));
  const [prices, setPrices] = useState(() => Object.fromEntries(groups.map((g) => [g.product, g.lines[0].suggestedPrice || ''])));
  const [submitted, setSubmitted] = useState(false);
  const { saving, serverError, submit } = useSubmit();
  const priceErrors = Object.fromEntries(Object.entries(prices).filter(([, v]) => { const c = priceCentsOf(v); return c === undefined || (c !== null && c <= 0); }).map(([k]) => [k, 'Enter the price like 12.50']));
  const errors = { ...(picked.size ? {} : { slabs: 'Pick at least one slab.' }), ...Object.fromEntries(Object.keys(priceErrors).map((p) => [`price-${p}`, priceErrors[p]])) };
  const firstError = Object.keys(errors)[0];

  const toggle = (key) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const send = () => {
    setSubmitted(true);
    if (firstError) { goToField(firstError); return; }
    submit(() => onAdd(lines.filter((l) => picked.has(l.slabKey)).map((l) => ({ slabKey: l.slabKey, price: (prices[l.product] || '').trim() || null, note: l.note }))));
  };

  return (
    <FormModal
      title={<>Add from cart <span className="fm-title-sub">· Hold #{hold.number}</span></>}
      size="m"
      onClose={onClose}
      onSubmit={send}
      submitLabel={`Add ${slabCount(picked.size)}`}
      savingLabel="Adding…"
      saving={saving}
      submitDisabled={!picked.size}
      dirtyCount={picked.size !== lines.length ? 1 : 0}
      errors={submitted ? errors : {}}
      showErrors={submitted}
      fieldLabels={{ slabs: 'Slabs', ...Object.fromEntries(groups.map((g) => [`price-${g.product}`, `Price for ${g.product}`])) }}
    >
      <ServerError message={serverError} />
      {groups.map((g, i) => (
        <FormSection key={g.product} title={g.product}>
          <FormField name={`price-${g.product}`} id={`ha-price-${i}`} label="Price / SF" error={submitted ? priceErrors[g.product] : ''}>
            <input id={`ha-price-${i}`} className="fm-input" inputMode="decimal" placeholder="$0.00" value={prices[g.product] ?? ''}
              disabled={saving} onChange={(e) => setPrices((p) => ({ ...p, [g.product]: e.target.value }))} />
          </FormField>
          <div className="hl-pick-list" data-field="slabs">
            {g.lines.map((l) => (
              <label key={l.slabKey} className="hl-pick">
                <input type="checkbox" className="hl-chk" checked={picked.has(l.slabKey)} disabled={saving} onChange={() => toggle(l.slabKey)} />
                <span className="grow"><b>{l.serial || l.slabKey}</b></span>
                <span className="muted">{[l.bundle && `Bundle ${l.bundle}`, formatSf(l.sfHundredths)].filter(Boolean).join(' · ')}</span>
              </label>
            ))}
          </div>
        </FormSection>
      ))}
    </FormModal>
  );
}
