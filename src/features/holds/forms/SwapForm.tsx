import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField } from '../../../components/shared/form/FormControls';
import { goToField } from '../../../components/shared/form/formFocus';
import { formatSf } from '../../../holds/holdRules';
import type { CartLine, Hold, HoldLine } from '../types';
import { ServerError } from './formParts';
import { useSubmit } from './useSubmit';

/** Swap one slab for another: scan or type it, or pick one of the same product from the cart. */
export default function SwapForm({ hold, line, cartLines = [], onSwap, onClose }: {
  hold: Hold; line: HoldLine; cartLines?: CartLine[]; onSwap: (to: string) => Promise<unknown>; onClose: () => void;
}) {
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
