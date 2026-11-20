import { FormSection, FormRow, FormField } from '../../../components/shared/form/FormControls';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import type { ExpenseProblems } from '../../../utils/cardReceipts';
import type { BillValues } from './BillCard';

type Props = {
  values: BillValues;
  errors: ExpenseProblems;
  today: string;
  set: (patch: Partial<BillValues>) => void;
};

const MONEY: { key: 'subtotal' | 'tax' | 'tip'; label: string }[] = [
  { key: 'subtotal', label: 'Subtotal' },
  { key: 'tax', label: 'Tax' },
  { key: 'tip', label: 'Tip' }
];

/**
 * The "Edit bill details" screen the pencil on the Bill details card opens
 * (inside the same FormModal): merchant, date, the total charged to the card,
 * and the optional subtotal, tax and tip. Total is what was charged — the
 * rest are only for the approver's information.
 */
export default function BillDetailsEdit({ values, errors, today, set }: Props) {
  return (
    <>
      <FormSection>
        <FormField name="merchant" id="ccr-merchant" label="Merchant" required error={errors.merchant}>
          <input id="ccr-merchant" className="fm-input" autoComplete="off" maxLength={80} placeholder="Where you paid" value={values.merchant} onChange={(e) => set({ merchant: e.target.value })} />
        </FormField>
        <FormRow>
          <FormField name="date" id="ccr-date" label="Date" required error={errors.date}>
            <DatePicker id="ccr-date" value={values.date} max={today} today={today} onChange={(d) => set({ date: d })} error={errors.date} sheetTitle="Date" />
          </FormField>
          <FormField name="total" id="ccr-total" label="Total" required error={errors.total}>
            <div className="ccr-money"><span aria-hidden="true">$</span>
              <input id="ccr-total" className="fm-input" inputMode="decimal" autoComplete="off" placeholder="0.00" value={values.total} onChange={(e) => set({ total: e.target.value })} />
            </div>
          </FormField>
        </FormRow>
      </FormSection>
      <FormSection>
        <div className="ccr-row-3">
          {MONEY.map(({ key, label }) => (
            <FormField key={key} name={key} id={`ccr-${key}`} label={label} error={errors[key]}>
              <div className="ccr-money"><span aria-hidden="true">$</span>
                <input id={`ccr-${key}`} className="fm-input" inputMode="decimal" autoComplete="off" placeholder="0.00" value={values[key]} onChange={(e) => set({ [key]: e.target.value })} />
              </div>
            </FormField>
          ))}
        </div>
      </FormSection>
    </>
  );
}
