import { useState } from 'react';
import type React from 'react';
import { Trash2 } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormRow, FormField, FormPicker } from '../../../components/shared/form/FormControls';
import type { FormOption } from '../../../components/shared/form/FormControls';
import { goToField, describedBy } from '../../../components/shared/form/formFocus';
import useTouched from '../../../components/shared/form/useTouched';
import useIsPhone from '../../../components/shared/form/useIsPhone';
import { formatPhoneInput } from '../../../utils/phoneUtils';
import { useStartingRep } from '../../../api/salesRepOptions';
import RepPicker from '../../../components/shared/form/RepPicker';
import LocationPicker from '../../../components/shared/form/LocationPicker';
import {
    STATUS_OPTIONS, LEVEL_OPTIONS, TYPE_OPTIONS, MODA_DISPLAY_OPTIONS, FIELD_LABELS, withCurrent,
    emptyCustomerValues, customerToFormValues, validateCustomerValues, withEmail, countCustomerChanges,
    customerLastChangedText
} from '../../../utils/customerForm';
import type { CustomerFormValues, CustomerAddress, Option } from '../../../utils/customerForm';
import type { Loose } from '../../../types/records';
import { customerRepOptions } from './customerFormView';
import { useDuplicateCheck } from './useDuplicateCheck';
import { useZipLookup } from './useZipLookup';
import { useCardScan } from './useCardScan';
import { CardMenuButton, CardScanPanel } from './CardScan';
import DuplicateNotice from './DuplicateNotice';
import './CustomerForm.css';

/*
 * Add customer / Edit customer, on the shared form template
 * (FORM_TEMPLATE.md), size M. Approved design: model A on the "Add & Edit
 * Customer" canvas (claude.ai/artifact/G6YUNXvbtVqScRGB7dHtXD) — groups with
 * dividers and no headings, every account setting a dropdown, the business
 * card behind the + next to the ✕, no Cancel.
 *
 * Mounted by AddCustomerModal (which keeps its old read-only view), so every
 * caller — Sales CRM, the Customers list, the route planner — gets it with
 * the same onSave(form, close) it already had. The rules are
 * src/utils/customerForm.ts; the duplicate check, the ZIP lookup and the
 * business card are their own hooks here (useDuplicateCheck, useZipLookup,
 * useCardScan), the card's parts CardScan.tsx.
 */

export type CustomerFormProps = {
    onClose: () => void;
    /** Called with the form's values and the close function, as every caller's save already was. */
    onSave: (values: CustomerFormValues, close: () => void) => void;
    isSaving?: boolean;
    editingCustomer?: Loose | null;
    salesReps?: Loose[];
    locations?: string[];
    currentUser?: Loose | null;
    onOpenExisting?: ((customer: Loose) => void) | null;
    /** Resolves true when the customer was deleted (the form then closes). */
    onDelete?: ((customer: Loose) => Promise<boolean> | boolean) | null;
    prefill?: (Partial<Omit<CustomerFormValues, 'address'>> & { address?: Partial<CustomerAddress> }) | null;
};

/** One text field's options (see `text` below). */
type TextOptions = {
    required?: boolean; type?: string; placeholder?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
    autoComplete?: string; asTyped?: boolean; onBlur?: () => void; status?: string | null; error?: string; value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

export default function CustomerForm({
    onClose, onSave, isSaving = false, editingCustomer = null,
    salesReps = [], locations = [], currentUser = null, onOpenExisting = null, onDelete = null, prefill = null
}: CustomerFormProps) {
    const isEdit = Boolean(editingCustomer);
    const isPhone = useIsPhone();
    // Who a new customer starts with: you if you're a sales rep, else the
    // branch's sales person (src/api/salesRepOptions.js → useStartingRep).
    const { repFor, ready: repsReady } = useStartingRep(currentUser);
    const defaults = emptyCustomerValues({ salesReps: salesReps as { _id: string; inactive?: boolean }[], locations, currentUser, repFor: repsReady ? repFor : null });
    const [initial, setInitial] = useState<CustomerFormValues>(() => (isEdit ? customerToFormValues(editingCustomer!) : defaults));
    // A new customer may open filled in (Permits → a contractor's "Create customer"):
    // those values count as changes, so closing asks before throwing them away.
    const [values, setValues] = useState<CustomerFormValues>(() => (!isEdit && prefill
        ? { ...initial, ...prefill, address: { ...initial.address, ...(prefill.address || {}) } }
        : initial));
    const [touched, touchField] = useTouched();
    const [submitted, setSubmitted] = useState(false);

    // The rep and branch lists are fetched by the caller and can arrive after
    // the form opens. Fill those two defaults in when they do — only where
    // still blank — and move the starting point with them, so an untouched
    // form doesn't count them as changes.
    if (!isEdit && ((defaults.salesRep && !initial.salesRep) || (defaults.location && !initial.location))) {
        const patch = { salesRep: initial.salesRep || defaults.salesRep, location: initial.location || defaults.location };
        setInitial({ ...initial, ...patch });
        setValues((v) => ({ ...v, salesRep: v.salesRep || patch.salesRep, location: v.location || patch.location }));
    }

    const set = (patch: Partial<CustomerFormValues>) => setValues((v) => ({ ...v, ...patch }));
    // A new customer moved to another branch takes that branch's starting rep
    // — unless someone already picked a different rep by hand.
    const offeredRep = (id: string) => Boolean(id) && salesReps.some((r) => String(r._id) === String(id) && !r.inactive);
    const setLocation = (location: string) => setValues((v) => {
        if (isEdit || !repsReady) return { ...v, location };
        const before = String(repFor(v.location)?._id || '');
        const after = String(repFor(location)?._id || '');
        const followsBranch = String(v.salesRep || '') === before;
        // Still the old branch's starting rep → the new branch's (Unassigned if it has none).
        return { ...v, location, ...(followsBranch ? { salesRep: offeredRep(after) ? after : '' } : {}) };
    });
    const setAddress = (patch: Partial<CustomerAddress>) => setValues((v) => ({ ...v, address: { ...v.address, ...patch } }));

    const errors: Record<string, string | undefined> = validateCustomerValues(values);
    const shown = (f: string) => (errors[f] && (submitted || touched[f]) ? errors[f] : '');
    const visibleErrors = Object.fromEntries(Object.keys(FIELD_LABELS).filter((k) => errors[k]).map((k) => [k, errors[k]]));
    const dirtyCount = countCustomerChanges(values, initial);

    // ── Possible duplicates (new customers only; advice, never blocks saving) ──
    const { dupMatches, dupDismissed, setDupDismissed } = useDuplicateCheck({ isEdit, company: values.company, phone: values.phone, email: values.email });

    // ── ZIP → city/state: only into blank fields; the last ZIP typed wins ──
    const { zipNote, setZipNote, setZipQuery } = useZipLookup(setValues);

    // ── Business card: the + next to the ✕ ──
    const { card, refs: cardRefs } = useCardScan({ isPhone, initial, setValues });
    const { plusRef, fileRef, videoRef, streamRef } = cardRefs;

    // ── Save ──
    const submit = () => {
        setSubmitted(true);
        const first = Object.keys(FIELD_LABELS).find((k) => errors[k]);
        if (first) {
            goToField(first);
            return;
        }
        onSave(values, onClose);
    };

    // Grouped under each rep's branch (customerFormView.ts).
    const repOptions = customerRepOptions(salesReps, values.salesRep, editingCustomer);

    const text = (name: string, label: string, { required = false, type = 'text', placeholder, inputMode, autoComplete = 'off', asTyped = false, onBlur, status, error, value, onChange }: TextOptions = {}) => {
        const id = `cf-${name}`;
        return (
            <FormField name={name} id={id} label={label} required={required} error={error} status={status}>
                <input
                    id={id}
                    className={`fm-input${asTyped ? ' no-capitalize' : ''}`}
                    type={type}
                    inputMode={inputMode}
                    value={value ?? (values as Loose)[name] ?? ''}
                    placeholder={placeholder}
                    autoComplete={autoComplete}
                    // Names and addresses: the keyboard capitalizes each word
                    // as typed (the form shows and saves exactly what's typed).
                    autoCapitalize={asTyped ? undefined : 'words'}
                    onChange={onChange || ((e) => set({ [name]: e.target.value }))}
                    onBlur={onBlur}
                    {...describedBy(id, error, status)}
                />
            </FormField>
        );
    };
    const picker = (name: keyof CustomerFormValues, label: string, options: readonly Option[], onChange = (v: string) => set({ [name]: v })) => (
        <FormField name={name} id={`cf-${name}`} label={label}>
            <FormPicker id={`cf-${name}`} value={values[name] as string} onChange={onChange} options={options as FormOption[]} sheetTitle={label} />
        </FormField>
    );

    const footerStart = isEdit && onDelete ? (
        <button
            type="button"
            className="fm-btn fm-btn-text-danger"
            disabled={isSaving || dirtyCount > 0}
            title={dirtyCount > 0 ? 'Save or discard your changes first' : 'Delete this customer'}
            onClick={async () => { if (await onDelete(editingCustomer!)) onClose(); }}
        >
            <Trash2 size={16} aria-hidden="true" />
            Delete customer
        </button>
    ) : null;

    return (
        <FormModal
            title={isEdit ? <>Edit customer <span className="fm-title-sub">· {editingCustomer!.company || editingCustomer!.contactName || 'Customer'}</span></> : 'Add a customer'}
            size="m"
            onClose={() => { card.stopCamera(); onClose(); }}
            onSubmit={submit}
            submitLabel={isEdit ? 'Save changes' : 'Add customer'}
            savingLabel="Saving…"
            saving={isSaving}
            submitDisabled={isEdit && dirtyCount === 0}
            dirtyCount={dirtyCount}
            discardTitle={isEdit ? 'Discard your changes?' : 'Discard this customer?'}
            errors={visibleErrors}
            showErrors={submitted}
            fieldLabels={FIELD_LABELS}
            footerStart={footerStart}
            footerNote={isEdit ? customerLastChangedText(editingCustomer!) : null}
            headerActions={<CardMenuButton card={card} plusRef={plusRef} isPhone={isPhone} isSaving={isSaving} />}
        >
            <CardScanPanel card={card} fileRef={fileRef} videoRef={videoRef} streamRef={streamRef} isPhone={isPhone} />

            <FormSection>
                {text('company', 'Company name', { required: true, error: shown('company'), onBlur: () => touchField('company', values.company !== initial.company) })}
                {!isEdit && !dupDismissed && dupMatches.length > 0 && (
                    <DuplicateNotice
                        matches={dupMatches}
                        onOpen={onOpenExisting ? (m) => { onClose(); onOpenExisting(m); } : null}
                        onDismiss={() => setDupDismissed(true)}
                    />
                )}
                <FormRow>
                    {text('customerName', 'Contact name')}
                    {text('phone', 'Phone', { type: 'tel', inputMode: 'tel', placeholder: '(555) 000-0000', asTyped: true, onChange: (e) => set({ phone: formatPhoneInput(e.target.value) }) })}
                </FormRow>
                <FormRow>
                    {text('email', 'Email', {
                        required: true, type: 'email', asTyped: true, error: shown('email'),
                        onChange: (e) => setValues((v) => withEmail(v, e.target.value)),
                        onBlur: () => touchField('email', values.email !== initial.email)
                    })}
                    {text('marketingEmail', 'Marketing email', { type: 'email', asTyped: true, placeholder: 'Same as email' })}
                </FormRow>
                <label className="cf-check">
                    <input type="checkbox" checked={Boolean(values.receiveMarketing)} onChange={(e) => set({ receiveMarketing: e.target.checked })} />
                    <span>Send marketing emails</span>
                </label>
            </FormSection>

            <FormSection>
                {text('street', 'Street address', { value: values.address.street, onChange: (e) => setAddress({ street: e.target.value }) })}
                <div className="cf-csz">
                    {text('city', 'City', { value: values.address.city, onChange: (e) => setAddress({ city: e.target.value }) })}
                    {text('state', 'State', { value: values.address.state, placeholder: 'WA', asTyped: true, onChange: (e) => setAddress({ state: e.target.value }) })}
                    {text('zipCode', 'ZIP code', {
                        value: values.address.zipCode, inputMode: 'numeric', asTyped: true, status: zipNote || null,
                        onChange: (e) => { setZipNote(''); setAddress({ zipCode: e.target.value }); },
                        onBlur: () => setZipQuery(values.address.zipCode.trim())
                    })}
                </div>
            </FormSection>

            <FormSection>
                <FormRow>
                    {picker('status', 'Status', withCurrent(STATUS_OPTIONS, values.status))}
                    {picker('level', 'Level', withCurrent(LEVEL_OPTIONS, values.level))}
                </FormRow>
                <FormRow>
                    {picker('customerType', 'Customer type', withCurrent(TYPE_OPTIONS, values.customerType))}
                    <FormField name="salesRep" id="cf-salesRep" label="Sales rep">
                        <RepPicker id="cf-salesRep" value={values.salesRep ? String(values.salesRep) : ''} onChange={(v) => set({ salesRep: v })} options={repOptions} noneLabel="Unassigned" you={currentUser?.id || currentUser?._id} />
                    </FormField>
                </FormRow>
                <FormRow>
                    <FormField name="location" id="cf-location" label="Location">
                        <LocationPicker id="cf-location" value={values.location || ''} onChange={setLocation} options={locations} user={currentUser} />
                    </FormField>
                    {picker('modaDisplay', 'Moda display', withCurrent(MODA_DISPLAY_OPTIONS, values.modaDisplay))}
                </FormRow>
                <FormRow>
                    {text('modaBinder', 'Moda binders', { placeholder: '0', inputMode: 'numeric', asTyped: true })}
                </FormRow>
            </FormSection>

            <FormSection>
                <FormField name="notes" id="cf-notes" label="Notes">
                    <textarea
                        id="cf-notes"
                        className="fm-input"
                        rows={4}
                        value={values.notes}
                        placeholder="Hours, access, preferences"
                        autoCapitalize="sentences"
                        onChange={(e) => set({ notes: e.target.value })}
                    />
                </FormField>
            </FormSection>
        </FormModal>
    );
}
