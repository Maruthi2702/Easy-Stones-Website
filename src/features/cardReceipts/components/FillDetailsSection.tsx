import { useEffect, useMemo, useState } from 'react';
import { FormSection, FormField, FormPicker, FormSearchPicker } from '../../../components/shared/form/FormControls';
import type { FormOption } from '../../../components/shared/form/FormControls';
import { useCustomerOptions } from '../../../api/customerOptions';
import { defaultSubOf, fieldsOf } from '../../../utils/cardReceipts';
import type { DetailsBody } from '../cardReceiptsApi';
import type { Category, Expense } from '../types';

export type FillDetailsSectionProps = {
  expense: Expense;
  categories: Category[];
  onSave: (body: DetailsBody) => Promise<unknown>;
};

/**
 * "Fill in for Accounting": an Admin's own receipt waits for Accounting (never
 * Missing receipt), who picks its category, type, customer and note here and
 * then approves it (receiptApproval.ts's canFillDetails). The pickers are Add
 * receipt's own (ExpenseForm); Save sends PUT /expenses/:id/details.
 */
export default function FillDetailsSection({ expense: e, categories, onSave }: FillDetailsSectionProps) {
  const start = useMemo(() => ({ category: e.category, subcategory: e.subcategory, customerId: e.customerId, customerName: e.customerName, note: e.note }), [e]);
  const [v, setV] = useState(start);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const customers = useCustomerOptions();
  useEffect(() => { setV(start); setSubmitted(false); setError(''); }, [start]);

  const offered = categories.filter((c) => c.active || c.name === start.category);
  const category = offered.find((c) => c.name === v.category);
  const fields = fieldsOf(category, v.subcategory);
  const subOptions: FormOption[] = (category?.subcategories || [])
    .filter((s) => s.active || s.name === start.subcategory)
    .map((s) => ({ value: s.name, label: s.active ? s.label : `${s.label} (hidden)`, keywords: s.label }));
  const customerOptions = useMemo(() => customers.options.map((o) => ({ value: o.value, label: o.label, description: o.description, keywords: o.keywords })), [customers.options]);
  const problems = {
    category: v.category ? '' : 'Choose a category',
    subcategory: subOptions.length && !v.subcategory ? 'Choose the type' : '',
    customer: fields.customer && !v.customerId ? 'Choose the customer' : '',
    note: fields.note && !v.note.trim() ? 'This category needs a note' : ''
  };
  const bad = Object.values(problems).some(Boolean);
  const dirty = v.category !== start.category || v.subcategory !== start.subcategory || v.customerId !== start.customerId || v.note !== start.note;

  const save = async () => {
    setSubmitted(true);
    if (bad) return;
    setSaving(true);
    setError('');
    try {
      await onSave({ category: v.category, subcategory: v.subcategory, customerId: fields.customer ? v.customerId : '', note: v.note.trim() });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSection title="Fill in for Accounting">
      {error ? <div className="ccr-form-error" role="alert">{error}</div> : null}
      <FormField name="fillCategory" id="ccr-fill-category" label="Category" required error={submitted ? problems.category : ''}>
        <FormSearchPicker id="ccr-fill-category" value={v.category}
          onChange={(c) => setV((x) => ({ ...x, category: c, subcategory: defaultSubOf(offered.find((o) => o.name === c))?.name || '' }))}
          options={offered.map((c) => ({ value: c.name, label: c.active ? c.label : `${c.label} (hidden)`, keywords: c.label }))}
          placeholder="Choose a category" searchPlaceholder="Search categories" sheetTitle="Category" maxResults={200} keepInForm />
      </FormField>
      {subOptions.length ? (
        <FormField name="fillSubcategory" id="ccr-fill-subcategory" label="Sub-category" required error={submitted ? problems.subcategory : ''}>
          <FormPicker id="ccr-fill-subcategory" value={v.subcategory} onChange={(s) => setV((x) => ({ ...x, subcategory: s }))} options={subOptions}
            placeholder="Choose the type" sheetTitle="Sub-category" keepInForm />
        </FormField>
      ) : null}
      {fields.customer ? (
        <FormField name="fillCustomer" id="ccr-fill-customer" label="Customer" required error={submitted ? problems.customer : ''}>
          <FormSearchPicker id="ccr-fill-customer" value={v.customerId} selectedLabel={v.customerName}
            onChange={(id) => setV((x) => ({ ...x, customerId: id, customerName: customers.options.find((c) => c.value === id)?.label || '' }))}
            options={customerOptions} loading={customers.loading} placeholder="Choose the customer"
            searchPlaceholder="Search name, city or contact" sheetTitle="Customer" keepInForm />
        </FormField>
      ) : null}
      <FormField name="fillNote" id="ccr-fill-note" label="Note" required={fields.note} error={submitted ? problems.note : ''}>
        <textarea id="ccr-fill-note" className="fm-input fm-textarea" rows={2} maxLength={500} autoCapitalize="sentences"
          value={v.note} onChange={(ev) => setV((x) => ({ ...x, note: ev.target.value }))} />
      </FormField>
      <div className="ccr-inline-actions">
        <button type="button" className="fm-btn fm-btn-primary fm-btn-small" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save details'}
        </button>
      </div>
    </FormSection>
  );
}
