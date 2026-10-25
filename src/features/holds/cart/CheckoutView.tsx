import { AlertTriangle, Lock, ArrowLeft } from 'lucide-react';
import { FormField, FormSearchPicker } from '../../../components/shared/form/FormControls';
import LocationPicker from '../../../components/shared/form/LocationPicker';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import { formatSf, addDays, DEFAULT_HOLD_DAYS, formatMoney } from '../../../holds/holdRules';
import type { Cart, Hold } from '../types';
import type { CurrentUser } from '../../../types/records';
import type { CustomerChoice, ShownLine } from './cartLines';
import { useCheckout } from './useCheckout';

const HOLD_LENGTHS = [7, 14, 30];

export type CheckoutViewProps = {
  user: CurrentUser | null;
  cart: Cart;
  chosen: ShownLine[];
  customers: CustomerChoice[];
  customersLoading: boolean;
  onBack: () => void;
  onDone: (hold: Hold) => void;
};

/** Create hold, inside the drawer: the form, the total, Back and Create Hold. */
export default function CheckoutView({ user, cart, chosen, customers, customersLoading, onBack, onDone }: CheckoutViewProps) {
  const {
    canExtend, meta, customerId, setPickedHere, branch, setBranch, days, setDays, customDate, setCustomDate, job, setJob,
    notes, setNotes, prices, setPrices, saving, error, tried, groups, today, priceErrors, totals, firstProblem, submit, shown
  } = useCheckout({ user, cart, chosen, onDone });

  return (
    <>
      <div className="cd-body">
        {error && <div className="cd-banner" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</div>}
        {tried && firstProblem && !error && <div className="cd-banner" role="alert"><AlertTriangle size={16} aria-hidden="true" />{firstProblem}</div>}

        <FormField name="customer" id="co-customer" label="Customer" required error={shown('customer')}>
          <FormSearchPicker
            id="co-customer"
            value={customerId}
            onChange={setPickedHere}
            options={customers}
            loading={customersLoading && customers.length === 0}
            selectedLabel={cart.customer?.name || customers.find((o) => o.value === customerId)?.label || ''}
            placeholder="Search customers"
            sheetTitle="Customer"
            error={shown('customer')}
          />
        </FormField>

        {meta && meta.branches.length > 1 && (
          <FormField name="branch" id="co-branch" label="Branch" required error={shown('branch')}>
            <LocationPicker id="co-branch" value={branch || ''} onChange={setBranch} options={meta.branches} user={user} sheetTitle="Branch" placeholder="Choose a branch" error={shown('branch')} />
          </FormField>
        )}

        <FormField name="expiry" id="co-days" label="Hold until" required error={shown('expiry')}>
          <div className="cd-chips" role="radiogroup" aria-label="Hold until">
            {HOLD_LENGTHS.map((d) => {
              const locked = d > DEFAULT_HOLD_DAYS && !canExtend;
              return (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={days === d}
                  className={`cd-chip${days === d ? ' on' : ''}`}
                  disabled={locked}
                  title={locked ? 'Needs the Extend permission' : undefined}
                  onClick={() => setDays(d)}
                >
                  {d} days{days === d && today ? ` · ${new Date(`${addDays(today, d)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` : ''}
                </button>
              );
            })}
            <button type="button" role="radio" aria-checked={days === 'date'} className={`cd-chip${days === 'date' ? ' on' : ''}`} onClick={() => setDays('date')}>Pick a date</button>
          </div>
          {days === 'date' && (
            <DatePicker className="cd-date" value={customDate} min={today || ''} today={today || undefined} shortcuts={[]}
              sheetTitle="Hold until" ariaLabel="Hold until date" onChange={setCustomDate} />
          )}
        </FormField>

        <FormField name="job" id="co-job" label="Job / reference">
          <input id="co-job" className="fm-input" value={job} maxLength={200} onChange={(e) => setJob(e.target.value)} />
        </FormField>

        <div className="cd-prices">
          <div className="cd-prices-head">Price / SF</div>
          {groups.map((g) => (
            <div key={g.product} className="cd-price-row">
              <div>
                <b>{g.product}</b>
                <span className={g.mixedLots ? 'warn' : ''}>{g.slabs} slab{g.slabs === 1 ? '' : 's'} · {formatSf(g.sfHundredths)}{g.mixedLots ? ` · ${g.bundles.length} bundles, colour may vary` : ''}</span>
              </div>
              <input
                className={`cd-price${priceErrors[g.product] ? ' bad' : ''}`}
                value={prices[g.product] ?? ''}
                inputMode="decimal"
                placeholder="$0.00"
                aria-label={`Price per SF for ${g.product}`}
                aria-invalid={Boolean(priceErrors[g.product])}
                onChange={(e) => setPrices((p) => ({ ...p, [g.product]: e.target.value }))}
              />
              <span className="cd-per">/SF</span>
            </div>
          ))}
        </div>

        <FormField name="notes" id="co-notes" label="Notes">
          <textarea id="co-notes" className="fm-input cd-notes" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
      </div>

      <footer className="cd-foot">
        <div className="cd-total">
          <span>{totals.slabs} slab{totals.slabs === 1 ? '' : 's'} · {formatSf(totals.sfHundredths)}</span>
          <span className="cd-total-amt">
            {totals.missingPrices && totals.missingPrices < totals.slabs ? 'Total so far ' : 'Total '}
            <b>{totals.missingPrices === totals.slabs ? '—' : formatMoney(totals.pricedCents)}</b>
          </span>
        </div>
        <div className="cd-foot-actions">
          <button type="button" className="fm-btn" onClick={onBack} disabled={saving}><ArrowLeft size={16} aria-hidden="true" />Back</button>
          <button type="button" className="fm-btn fm-btn-primary cd-grow" onClick={submit} disabled={saving} aria-busy={saving}>
            <Lock size={16} aria-hidden="true" />{saving ? 'Creating hold…' : 'Create Hold'}
          </button>
        </div>
      </footer>
    </>
  );
}
