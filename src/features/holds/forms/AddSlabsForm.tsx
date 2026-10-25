import { useMemo, useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField } from '../../../components/shared/form/FormControls';
import { goToField } from '../../../components/shared/form/formFocus';
import { lotGroups, formatSf, priceCentsOf } from '../../../holds/holdRules';
import { slabCount } from '../../../utils/holdView';
import type { CartLine, Hold, LotGroup } from '../types';
import { ServerError } from './formParts';
import { useSubmit } from './useSubmit';

/** A slab added from the cart: its key, the typed price (null = none yet) and its note. */
export type AddedSlab = { slabKey: string; price: string | null; note: string };

/** A cart slab offered to a hold, with the price its product already has there (cartSlabsFor). */
export type OfferedSlab = CartLine & { suggestedPrice?: string };

/** An offered slab as the form lists it. */
type OfferedLine = { slabKey: string; product: string; suggestedPrice?: string; note: string; serial?: string; bundle?: string; sfHundredths?: number; [key: string]: unknown };

/** Add cart slabs to the hold, priced per product (prefilled from the hold's own price). */
export default function AddSlabsForm({ hold, offered, onAdd, onClose }: { hold: Hold; offered: OfferedSlab[]; onAdd: (add: AddedSlab[]) => Promise<unknown>; onClose: () => void }) {
  const lines = useMemo((): OfferedLine[] => offered.map((l) => ({ ...l.slab, slabKey: l.slabKey, product: l.slab?.product || '', suggestedPrice: l.suggestedPrice, note: l.note || '' })), [offered]);
  const groups = lotGroups(lines) as LotGroup<OfferedLine>[];
  const [picked, setPicked] = useState(() => new Set(lines.map((l) => l.slabKey)));
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(groups.map((g) => [g.product, g.lines[0].suggestedPrice || ''])));
  const [submitted, setSubmitted] = useState(false);
  const { saving, serverError, submit } = useSubmit();
  const priceErrors = Object.fromEntries(Object.entries(prices).filter(([, v]) => { const c = priceCentsOf(v); return c === undefined || (c !== null && c <= 0); }).map(([k]) => [k, 'Enter the price like 12.50']));
  const errors: Record<string, string> = { ...(picked.size ? {} : { slabs: 'Pick at least one slab.' }), ...Object.fromEntries(Object.keys(priceErrors).map((p) => [`price-${p}`, priceErrors[p]])) };
  const firstError = Object.keys(errors)[0];

  const toggle = (key: string) => setPicked((s) => {
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
