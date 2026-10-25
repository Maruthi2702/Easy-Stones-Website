import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Clock, Trash2 } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormRow, FormField, FormSearchPicker } from '../../../components/shared/form/FormControls';
import { goToField } from '../../../components/shared/form/formFocus';
import useTouched from '../../../components/shared/form/useTouched';
import { MAX_TRUCK_CAPACITY } from '../../../api/deliverySchedule';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { useSalesRepOptions, useStartingRep } from '../../../api/salesRepOptions';
import RepPicker from '../../../components/shared/form/RepPicker';
// Field builders (the shared LocationPicker and DatePicker inside), here where
// LocationPicker was imported, so the stylesheets load in the same order.
import { fieldHelpers } from './formFields';
import type { FieldName } from './formFields';
import { branchesOf } from '../../../utils/salesReps';
import { formatTitleCase } from '../../../utils/textUtils';
import { formatAmount, sanitizeAmountInput } from '../../../utils/money';
import { isThirdPartyTruck } from '../../../utils/deliveryPickup';
import { isWeekendDate, dayLabel } from '../../../utils/deliveryWeek';
import { saveDraft, loadDraft, clearDraft } from '../../../utils/sessionDraft';
import { useCustomerOptions } from '../../../api/customerOptions';
import {
    DELIVERY_TYPE_OPTIONS, STATUS_OPTIONS, isPendingOrder, dateLabelFor, needsFreightDetails, fieldLabelsFor,
    deliveryToFormValues, validateDeliveryValues, countDeliveryChanges, driverOptions, driverPickerValue,
    applyDriverPick, applyTypeChange, applyDateChange, applyCustomerPick, applyCustomName, buildDeliveryPayload,
    formWording, deliveryLastChangedText,
    reportDaysTouched, submittedDayLabel
} from '../../../utils/deliveryForm';
import { usePackingList } from './usePackingList';
import PackingListField from './PackingListField';
import DeleteConfirm from './DeleteConfirm';
import type { DeliveryFormValues } from '../../../utils/deliveryForm';
import type { CustomerOption } from '../../../utils/customerOptions';
import type { CurrentUser, Loose } from '../../../types/records';
import type { BoardColumn, Ticket } from '../types';
import './DeliveryForm.css';

/*
 * Add / Edit delivery on the shared form template (FORM_TEMPLATE.md), size L.
 * Approved design: the "Add & Edit Delivery" canvas
 * (claude.ai/artifact/MUFMQHSj2xPKo3o9JeXjXC) with the owner's field order of
 * 2026-10-05 — Date | Delivery type, Customer | Sales rep, SO | No. of slabs,
 * Driver | Status, Stop | Delivery address; a 3rd-party truck adds Carrier
 * name, BOL # and Agreed price (optional); then Packing list and Notes.
 *
 * Same props as the DeliveryModal it replaces, so the board only swaps the
 * import. The rules are src/utils/deliveryForm.ts; saves still go through
 * onSave → saveDelivery → POST /api/deliveries.
 */

/** What the save sends (buildDeliveryPayload in src/utils/deliveryForm.ts). */
export type DeliveryPayload = ReturnType<typeof buildDeliveryPayload>;

export type DeliveryFormProps = {
    isOpen: boolean;
    onClose: () => void;
    /** Saves the ticket; throws with the server's reason to show. */
    onSave: (payload: DeliveryPayload) => Promise<unknown>;
    onDelete?: (id: string) => Promise<unknown>;
    /** The ticket being edited, or a new one's starting values (no id). */
    initialData?: Loose | null;
    trucks?: BoardColumn[];
    deliveries?: Ticket[];
    customerOptions?: CustomerOption[];
    locationsList?: string[];
    currentUser?: CurrentUser | null;
};

const STOP_OPTIONS = Array.from({ length: MAX_TRUCK_CAPACITY }, (_, i) => ({ value: String(i + 1), label: `Stop ${i + 1}` }));

export default function DeliveryForm(props: DeliveryFormProps) {
    if (!props.isOpen) return null;
    // A fresh form every time it opens, so nothing carries over between tickets.
    return <DeliveryFormBody {...props} />;
}

function DeliveryFormBody({
    onClose, onSave, onDelete, initialData = null, trucks = [], deliveries = [],
    customerOptions = [], locationsList = [], currentUser = null
}: DeliveryFormProps) {
    const isEdit = Boolean(initialData?.id);
    const draftKey = `deliveryModal:${initialData?.id || 'new'}`;

    // ── Lists the form needs ──
    // The shared customer list (src/api/customerOptions.js) when the board
    // didn't hand one in — the same list and rules as every customer dropdown.
    const { options: sharedCustomers, loading: sharedCustomersLoading } = useCustomerOptions();
    const customers = customerOptions?.length ? customerOptions : sharedCustomers;
    const customersLoading = !customers.length && sharedCustomersLoading;

    // ── Values ──
    // Who a new ticket starts with as its rep: you if you're a sales rep, else
    // the branch's sales person (src/api/salesRepOptions.js → useStartingRep).
    const { repFor, ready: repsReady } = useStartingRep(currentUser);
    const branch = initialData?.location || currentUser?.location || '';
    const startingRep = repsReady && !isEdit ? (repFor(branch)?.name || '') : '';
    const [initial, setInitial] = useState(() => deliveryToFormValues(initialData, { currentUser, customerOptions: customers, startingRep, deliveries }));
    // A session that expired mid-edit left this ticket's values behind.
    const [restored] = useState(() => loadDraft(draftKey) as Loose | null);
    const [values, setValues] = useState<DeliveryFormValues>(() => (restored ? { ...initial, ...pickKnown(restored, initial) } : initial));
    // The lists can land after the form opens: fill the starting rep in then —
    // only on a new ticket whose rep nobody has touched — and move the
    // starting point with it, so it doesn't count as a change.
    if (startingRep && !restored && !initialData?.salesRepName
        && initial.salesRepName !== startingRep && values.salesRepName === initial.salesRepName) {
        setInitial({ ...initial, salesRepName: startingRep });
        setValues((v) => ({ ...v, salesRepName: startingRep }));
    }
    // The shared sales rep list (src/api/salesRepOptions.js): reps on the
    // branches this person works at; the ticket's saved rep always shows.
    const repChoices = useSalesRepOptions({ branches: branchesOf(currentUser), current: { name: values.salesRepName } });
    useEffect(() => { if (restored) clearDraft(draftKey); }, [restored, draftKey]);
    const valuesRef = useRef(values);
    valuesRef.current = values;
    useEffect(() => {
        const stash = () => saveDraft(draftKey, valuesRef.current);
        window.addEventListener('auth:session-expired', stash);
        return () => window.removeEventListener('auth:session-expired', stash);
    }, [draftKey]);

    const set = (patch: Partial<DeliveryFormValues>) => setValues((v) => ({ ...v, ...patch }));
    const [touched, touchField] = useTouched();
    const [submitted, setSubmitted] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);

    // ── Days whose Daily Report is already submitted ──
    // A ticket changed (or added) on a signed-off day doesn't change that
    // report — it's frozen as submitted — so the board and the report would
    // quietly disagree. Say so, naming the day, so someone can reopen it.
    // Checks the day the ticket was on when opened and the day it's on now
    // (and a transfer's arrival day at the receiving branch).
    const filedUnder = initialData?.location || currentUser?.location || '';
    const touchedDays = reportDaysTouched(values, { initial: isEdit ? initial : null, location: filedUnder });
    const touchedKey = touchedDays.map((d) => `${d.location}|${d.date}`).join(',');
    const [submittedDays, setSubmittedDays] = useState<{ location: string; date: string }[]>([]);
    useEffect(() => {
        if (!touchedKey) { setSubmittedDays([]); return undefined; }
        let live = true;
        const timer = setTimeout(() => {
            authFetch(`${API_URL}/api/daily-reports/submitted-days?days=${encodeURIComponent(touchedKey)}`)
                .then((res) => (res.ok ? res.json() : { days: [] }))
                .then((data) => { if (live) setSubmittedDays(data.days || []); })
                .catch(() => { if (live) setSubmittedDays([]); });
        }, 300);
        return () => { live = false; clearTimeout(timer); };
    }, [touchedKey]);

    const errors = validateDeliveryValues(values);
    const shown = (f: string): string => ((errors as Record<string, string | undefined>)[f] && (submitted || touched[f]) ? (errors as Record<string, string>)[f] : '');
    const touch = (f: FieldName) => touchField(f, String(values[f] ?? '') !== String(initial[f] ?? ''));
    const dirtyCount = countDeliveryChanges(values, initial);
    const wording = formWording(values, { isEdit, saved: initial });

    const type = values.deliveryType;
    const isTransfer = type === 'transfer';
    const isWillCall = type === 'will_call';
    const hasRoute = type === 'jobsite' || type === 'return';
    const freight = needsFreightDetails(values, trucks);
    const pending = isPendingOrder(values);
    const dropOff = type === 'return' && !values.truckId && values.customerDropOff;

    // ── Packing list ──
    const packing = usePackingList({ values, latestValues: () => valuesRef.current, set, setValues, customers });
    const { pdfBusy } = packing;

    // ── Save / delete ──
    const submit = async () => {
        setSubmitted(true);
        const first = Object.keys(errors)[0];
        if (first) {
            goToField(first);
            return;
        }
        setSaving(true);
        setSaveError('');
        try {
            await onSave(buildDeliveryPayload(values, { savedTicket: initialData, currentUser, customerOptions: customers, trucks }));
            onClose();
        } catch (err) {
            console.error('[DeliveryForm] save failed:', err);
            // The server's reason when it gave one (saveDelivery throws it);
            // a dropped connection gets the plain message.
            const message = (err as Error)?.message;
            const reason = message && !/fetch|network|malformed/i.test(message) ? message : '';
            setSaveError(reason || 'Couldn’t save. Check your connection and try again.');
            setSaving(false);
        }
    };

    const canDelete = isEdit && onDelete && currentUser?.permissions?.includes('delete_delivery_schedule');
    const deleteNow = async () => {
        setConfirmDelete(false);
        setSaving(true);
        try {
            await onDelete!(initialData!.id);
            onClose();
        } catch (err) {
            // deleteDelivery throws when the ticket wasn't deleted, so the form
            // stays open and says so instead of closing as if it had worked.
            console.error('[DeliveryForm] delete failed:', err);
            setSaveError((err as { userMessage?: string })?.userMessage || 'Couldn’t delete it. Try again.');
            setSaving(false);
        }
    };
    const footerStart = canDelete ? (
        <button
            type="button"
            className="fm-btn fm-btn-text-danger"
            disabled={saving || dirtyCount > 0}
            title={dirtyCount > 0 ? 'Save or discard your changes first' : wording.deleteLabel}
            onClick={() => setConfirmDelete(true)}
        >
            <Trash2 size={16} aria-hidden="true" />
            {wording.deleteLabel}
        </button>
    ) : null;

    // ── Options ──
    // Built only when what they depend on changes, not on every keystroke: the
    // customer list can be thousands long, and each driver's load is counted
    // across the week's deliveries.
    const { truckId, date, deliveryType, customerDropOff } = values;
    // Already shaped by the shared rules: city under the name, contact searchable.
    const customerPickerOptions = customers;
    const drivers = useMemo(
        () => driverOptions(trucks, { truckId, date, deliveryType, customerDropOff } as DeliveryFormValues, { deliveries, exceptId: initialData?.id, max: MAX_TRUCK_CAPACITY }),
        [trucks, truckId, date, deliveryType, customerDropOff, deliveries, initialData?.id]
    );

    // ── Field helpers ──
    const { text, dateInput, picker, branchPicker } = fieldHelpers({ values, set, shown, locationsList, currentUser });

    const dateField = dateInput('date', dateLabelFor(values), {
        required: !pending,
        error: shown('date'),
        // Weekend work is rare but real, so this informs rather than blocks.
        status: isWeekendDate(values.date) ? (
            <><AlertTriangle size={12} aria-hidden="true" />{`${dayLabel(values.date).name} — weekend ${isTransfer ? 'transfer' : type === 'jobsite' ? 'delivery' : 'pickup'}`}</>
        ) : null,
        onChange: (iso: string) => setValues((v) => applyDateChange(v, iso, { savedTicket: initialData, deliveries })),
        onBlur: () => touch('date')
    });

    const typeField = picker('deliveryType', 'Delivery type', DELIVERY_TYPE_OPTIONS, {
        onChange: (next: string) => setValues((v) => applyTypeChange(v, next, { isNew: !isEdit, thirdPartyTruckId: trucks.find(isThirdPartyTruck)?.id }))
    });

    const slabsField = text('numberOfSlabs', 'No. of slabs', {
        inputMode: 'numeric',
        asTyped: true,
        placeholder: '0',
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => set({ numberOfSlabs: e.target.value.replace(/\D/g, '').slice(0, 4) })
    });

    const driverField = picker('truckId', 'Driver', drivers, {
        value: driverPickerValue(values),
        onChange: (picked: string) => setValues((v) => applyDriverPick(v, picked, initialData, deliveries)),
        status: pending
            ? <><Clock size={12} aria-hidden="true" />Waits in Pending Delivery until a driver is picked</>
            : dropOff ? <><Clock size={12} aria-hidden="true" />Shows in the Will Call column on that date</> : null
    });

    const statusField = picker('status', 'Status', STATUS_OPTIONS);

    return (
        <FormModal
            title={isEdit ? <>{wording.title}{wording.titleSub && <span className="fm-title-sub"> · {wording.titleSub}</span>}</> : wording.title}
            size="l"
            onClose={onClose}
            onSubmit={submit}
            submitLabel={pdfBusy ? 'Attaching PDF…' : wording.submitLabel}
            savingLabel="Saving…"
            saving={saving}
            submitDisabled={pdfBusy || (isEdit && dirtyCount === 0)}
            dirtyCount={dirtyCount}
            discardTitle={wording.discardTitle}
            errors={errors}
            showErrors={submitted}
            fieldLabels={fieldLabelsFor(values)}
            footerStart={footerStart}
            footerNote={isEdit ? deliveryLastChangedText(initialData) : null}
        >
            {restored && <div className="df-note df-note-ok" role="status">We restored what you’d entered before your session expired.</div>}
            {saveError && <div className="df-note df-note-err" role="alert">{saveError}</div>}
            {submittedDays.length > 0 && (
                <div className="df-note df-note-warn" role="status">
                    <AlertTriangle size={15} aria-hidden="true" />
                    <span>
                        {submittedDays.map(submittedDayLabel).join(' and ')} {submittedDays.length === 1 ? 'is' : 'are'} already
                        submitted. Saving won’t change {submittedDays.length === 1 ? 'it' : 'them'}; reopen {submittedDays.length === 1 ? 'that day' : 'those days'} in
                        the Daily Report to bring the figures up to date.
                    </span>
                </div>
            )}

            <FormSection>
                <FormRow>
                    {dateField}
                    {typeField}
                </FormRow>

                {isTransfer ? (
                    <>
                        <div className="df-pair">
                            {branchPicker('transferOrigin', 'From')}
                            {branchPicker('transferDestination', 'To')}
                        </div>
                        <FormRow>
                            {dateInput('expectedArrivalDate', 'Expected arrival', {
                                required: Boolean(values.date), error: shown('expectedArrivalDate'),
                                onBlur: () => touch('expectedArrivalDate')
                            })}
                            {text('soNumber', 'Transfer #', { asTyped: true, placeholder: 'TRF-10482' })}
                        </FormRow>
                        <FormRow>
                            {slabsField}
                            {driverField}
                        </FormRow>
                        <FormRow>
                            {statusField}
                        </FormRow>
                    </>
                ) : (
                    <>
                        <FormRow>
                            <FormField name="customer" id="df-customer" label="Customer" required error={shown('customer')}>
                                <FormSearchPicker
                                    id="df-customer"
                                    value={values.selectedCustomerId}
                                    selectedLabel={values.customerName}
                                    onChange={(v) => setValues((cur) => applyCustomerPick(
                                        cur,
                                        customers.find((o) => o.value === v),
                                        customers.find((o) => o.value === cur.selectedCustomerId)
                                    ))}
                                    options={customerPickerOptions}
                                    loading={customersLoading && !customers.length}
                                    placeholder="Search customers"
                                    searchPlaceholder="Name or city"
                                    sheetTitle="Customer"
                                    onCreateNew={(typed) => { if (typed) setValues((cur) => applyCustomName(cur, typed, formatTitleCase)); }}
                                    createNewLabel={(q) => (q ? `Use “${q}” as a new name` : null)}
                                    error={shown('customer')}
                                />
                            </FormField>
                            <FormField name="salesRepName" id="df-salesRepName" label="Sales rep">
                                <RepPicker id="df-salesRepName" value={values.salesRepName} onChange={(v) => set({ salesRepName: v })} options={repChoices} you={currentUser?._id || currentUser?.id} />
                            </FormField>
                        </FormRow>
                        <div className="df-pair">
                            {text('soNumber', 'SO / invoice #', { asTyped: true, placeholder: 'SO-48213' })}
                            {slabsField}
                        </div>
                        <FormRow>
                            {isWillCall
                                ? text('pickupInfo', 'Pick-up vehicle', { asTyped: true, placeholder: 'License plate' })
                                : driverField}
                            {statusField}
                        </FormRow>
                        {hasRoute && (
                            <FormRow>
                                {picker('routeNumber', 'Stop', STOP_OPTIONS)}
                                {text('address', 'Delivery address', { placeholder: 'Street, city' })}
                            </FormRow>
                        )}
                    </>
                )}
            </FormSection>

            {freight && (
                <FormSection>
                    <div className="df-freight">
                        <div className="df-freight-carrier">
                            {text('carrierName', 'Carrier name', { placeholder: 'R+L Carriers' })}
                        </div>
                        {text('proNumber', 'BOL #', { asTyped: true, placeholder: 'BOL-77310' })}
                        <FormField name="freightFee" id="df-freightFee" label="Agreed price">
                            <div className="df-money">
                                <span aria-hidden="true">$</span>
                                {/* Text, not number: a number box can't hold "1,400.00" and
                                    changes the amount on a scroll-wheel. Formatted on blur so
                                    the caret doesn't jump while typing. */}
                                <input
                                    id="df-freightFee"
                                    className="fm-input no-capitalize"
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="0.00"
                                    value={values.freightFee}
                                    onChange={(e) => set({ freightFee: sanitizeAmountInput(e.target.value) })}
                                    onBlur={() => set({ freightFee: formatAmount(values.freightFee) })}
                                />
                            </div>
                        </FormField>
                    </div>
                </FormSection>
            )}

            <FormSection>
                <PackingListField values={values} initialData={initialData} packing={packing} />
                <FormField name="notes" id="df-notes" label="Notes">
                    <textarea
                        id="df-notes"
                        className="fm-input"
                        rows={4}
                        value={values.notes}
                        autoCapitalize="sentences"
                        onChange={(e) => set({ notes: e.target.value })}
                    />
                </FormField>
            </FormSection>

            {confirmDelete && (
                <DeleteConfirm
                    title={`${wording.deleteLabel}?`}
                    subject={isTransfer ? `The ${wording.titleSub} transfer` : (initial.customerName || 'This ticket')}
                    onCancel={() => setConfirmDelete(false)}
                    onDelete={deleteNow}
                />
            )}
        </FormModal>
    );
}

// Only the fields this form has, from a draft saved by this form or by the old
// DeliveryModal (same names).
function pickKnown(draft: Loose, shape: DeliveryFormValues): Partial<DeliveryFormValues> {
    return Object.fromEntries(Object.keys(shape).filter((k) => draft[k] !== undefined).map((k) => {
        const v = draft[k];
        return [k, typeof shape[k as FieldName] === 'string' && typeof v !== 'string' ? String(v ?? '') : v];
    }));
}
