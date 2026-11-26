import { FormSection, FormRow, FormField } from '../../../components/shared/form/FormControls';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import { billMismatchLine, typedBillMismatch, usDate, type ExpenseProblems } from '../../../utils/cardReceipts';
import type { BillValues } from './BillCard';
import WarnLines from './WarnLines';

type Props = {
  values: BillValues;
  errors: ExpenseProblems;
  today: string;
  set: (patch: Partial<BillValues>) => void;
  /** A Missing receipt row: the bank's day and total stand, so they can't be changed here (review B10). */
  fromBank?: boolean;
  /** Checks shown above the fields (the same photo already on a receipt): this screen opens by itself after an upload. */
  warnings?: readonly string[];
};

const MONEY: { key: 'subtotal' | 'fees' | 'tax' | 'tip'; label: string }[] = [
  { key: 'subtotal', label: 'Subtotal' },
  { key: 'fees', label: 'Fees' },
  { key: 'tax', label: 'Tax' },
  { key: 'tip', label: 'Tip' }
];

/**
 * The "Edit bill details" screen the pencil on the Bill details card opens
 * (inside the same FormModal): merchant, date, the total charged to the card,
 * and the optional subtotal, fees (delivery charge, service fee), tax and tip. Total is what was charged — the
 * rest are for the approver's information; when they don't add up to the
 * total a line says so (never blocks: a receipt can carry a discount or fee).
 */
export default function BillDetailsEdit({ values, errors, today, set, fromBank = false, warnings = [] }: Props) {
  return (
    <>
      <WarnLines lines={warnings} />
      <FormSection>
        <FormField name="merchant" id="ccr-merchant" label="Merchant" required error={errors.merchant}>
          <input id="ccr-merchant" className="fm-input" autoComplete="off" maxLength={80} placeholder="Where you paid" value={values.merchant} onChange={(e) => set({ merchant: e.target.value })} />
        </FormField>
        {fromBank ? <p className="ccr-sub" role="note">The date and total come from the bank’s statement, so they can’t be changed.</p> : null}
        <FormRow>
          <FormField name="date" id="ccr-date" label="Date" required error={errors.date}>
            {fromBank ? <div className="ccr-ro" id="ccr-date">{usDate(values.date)}</div> : (
            <DatePicker id="ccr-date" value={values.date} max={today} today={today} onChange={(d) => set({ date: d })} error={errors.date} sheetTitle="Date" />)}
          </FormField>
          <FormField name="total" id="ccr-total" label="Total" required error={errors.total}>
            {fromBank ? <div className="ccr-ro" id="ccr-total">${values.total}</div> : (
              <div className="ccr-money"><span aria-hidden="true">$</span>
                <input id="ccr-total" className="fm-input" inputMode="decimal" autoComplete="off" placeholder="0.00" value={values.total} onChange={(e) => set({ total: e.target.value })} />
              </div>)}
          </FormField>
        </FormRow>
      </FormSection>
      <FormSection>
        <div className="ccr-row-4">
          {MONEY.map(({ key, label }) => (
            <FormField key={key} name={key} id={`ccr-${key}`} label={label} error={errors[key]}>
              <div className="ccr-money"><span aria-hidden="true">$</span>
                <input id={`ccr-${key}`} className="fm-input" inputMode="decimal" autoComplete="off" placeholder="0.00" value={values[key]} onChange={(e) => set({ [key]: e.target.value })} />
              </div>
            </FormField>
          ))}
        </div>
        <WarnLines lines={[billMismatchLine(typedBillMismatch(values))]} />
      </FormSection>
    </>
  );
}
