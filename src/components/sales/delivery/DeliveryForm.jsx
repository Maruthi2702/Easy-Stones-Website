import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Clock, FileText, Trash2, Upload, X } from 'lucide-react';
import FormModal from '../../shared/form/FormModal';
import { FormSection, FormRow, FormField, FormPicker, FormSearchPicker } from '../../shared/form/FormControls';
import { goToField, describedBy } from '../../shared/form/formFocus';
import useTouched from '../../shared/form/useTouched';
import { MAX_TRUCK_CAPACITY } from '../../../api/deliverySchedule';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { formatTitleCase } from '../../../utils/textUtils';
import { formatAmount, sanitizeAmountInput } from '../../../utils/money';
import { isThirdPartyTruck } from '../../../utils/deliveryPickup';
import { isWeekendDate, dayLabel } from '../../../utils/deliveryWeek';
import { saveDraft, loadDraft, clearDraft } from '../../../utils/sessionDraft';
import { planPackingListAutofill } from '../../../utils/packingListPdf';
import { useCustomerOptions } from '../../../api/customerOptions';
import {
    DELIVERY_TYPE_OPTIONS, STATUS_OPTIONS, isPendingOrder, dateLabelFor, needsFreightDetails, fieldLabelsFor,
    deliveryToFormValues, validateDeliveryValues, countDeliveryChanges, driverOptions, driverPickerValue,
    applyDriverPick, applyTypeChange, applyDateChange, applyCustomerPick, applyCustomName, buildDeliveryPayload,
    formWording, deliveryLastChangedText, repOptions, salesRepNamesFor
} from '../../../utils/deliveryForm';
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
 * import. The rules are src/utils/deliveryForm.js; saves still go through
 * onSave → saveDelivery → POST /api/deliveries.
 */

const STOP_OPTIONS = Array.from({ length: MAX_TRUCK_CAPACITY }, (_, i) => ({ value: String(i + 1), label: `Stop ${i + 1}` }));

export default function DeliveryForm(props) {
    if (!props.isOpen) return null;
    // A fresh form every time it opens, so nothing carries over between tickets.
    return <DeliveryFormBody {...props} />;
}

function DeliveryFormBody({
    onClose, onSave, onDelete, initialData = null, trucks = [], deliveries = [],
    customerOptions = [], locationsList = [], currentUser = null
}) {
    const isEdit = Boolean(initialData?.id);
    const draftKey = `deliveryModal:${initialData?.id || 'new'}`;

    // ── Lists the form needs ──
    // The shared customer list (src/api/customerOptions.js) when the board
    // didn't hand one in — the same list and rules as every customer dropdown.
    const { options: sharedCustomers, loading: sharedCustomersLoading } = useCustomerOptions();
    const customers = customerOptions?.length ? customerOptions : sharedCustomers;
    const customersLoading = !customers.length && sharedCustomersLoading;
    const [repNames, setRepNames] = useState(['Admin']);

    useEffect(() => {
        let live = true;
        authFetch(`${API_URL}/api/salesreps`)
            .then((res) => (res.ok ? res.json() : []))
            .then((payload) => { if (live) setRepNames(salesRepNamesFor(payload?.data || payload || [], currentUser)); })
            .catch((err) => console.warn('Failed to fetch sales reps in DeliveryForm:', err));
        return () => { live = false; };
        // Once per open.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Values ──
    const [initial] = useState(() => deliveryToFormValues(initialData, { currentUser, customerOptions: customers }));
    // A session that expired mid-edit left this ticket's values behind.
    const [restored] = useState(() => loadDraft(draftKey));
    const [values, setValues] = useState(() => (restored ? { ...initial, ...pickKnown(restored, initial) } : initial));
    useEffect(() => { if (restored) clearDraft(draftKey); }, [restored, draftKey]);
    const valuesRef = useRef(values);
    valuesRef.current = values;
    useEffect(() => {
        const stash = () => saveDraft(draftKey, valuesRef.current);
        window.addEventListener('auth:session-expired', stash);
        return () => window.removeEventListener('auth:session-expired', stash);
    }, [draftKey]);

    const set = (patch) => setValues((v) => ({ ...v, ...patch }));
    const [touched, touchField] = useTouched();
    const [submitted, setSubmitted] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);

    const errors = validateDeliveryValues(values);
    const shown = (f) => (errors[f] && (submitted || touched[f]) ? errors[f] : '');
    const touch = (f) => touchField(f, String(values[f] ?? '') !== String(initial[f] ?? ''));
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
    const [pdfBusy, setPdfBusy] = useState(false);
    const [pasteOpen, setPasteOpen] = useState(false);
    const [autofill, setAutofill] = useState(null);
    const fileRef = useRef(null);

    // Fill the form's empty fields from an uploaded StoneProfits packing list
    // (packingListPdf.js). Reads the latest values, since the upload can
    // finish after someone has typed into the form.
    const applyAutofill = (parsed) => {
        const { updates, filled, kept } = planPackingListAutofill(valuesRef.current, parsed, customers);
        if (Object.keys(updates).length) setValues((v) => ({ ...v, ...updates }));
        const source = parsed.documentType ? parsed.documentType.toLowerCase() : 'packing list';
        setAutofill(filled.length || kept.length ? { filled, kept, source } : null);
    };

    const attachFile = async (file) => {
        setPdfBusy(true);
        setPasteOpen(false);
        set({ packingListFilename: file.name });
        const inline = () => new Promise((resolve) => {
            // The upload route failed: send it inline instead, and the save
            // route stores it (after checking it really is a PDF).
            const reader = new FileReader();
            reader.onloadend = () => { set({ packingListUrl: reader.result }); resolve(); };
            reader.readAsDataURL(file);
        });
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await authFetch(`${API_URL}/api/deliveries/upload-packing-list`, { method: 'POST', body: formData });
            if (res.ok) {
                const data = await res.json();
                set({ packingListUrl: data.url, packingListFilename: data.filename || file.name });
                if (data.packingList) applyAutofill(data.packingList);
            } else {
                await inline();
            }
        } catch {
            await inline();
        } finally {
            setPdfBusy(false);
        }
    };

    const onPasteLink = (val) => {
        const isUrl = val.startsWith('http://') || val.startsWith('https://');
        const name = isUrl ? (val.split('/').pop() || 'PackingList.pdf') : val;
        set({ packingListUrl: val, packingListFilename: name });
    };
    const removePdf = () => {
        set({ packingListUrl: '', packingListFilename: '' });
        setAutofill(null);
    };
    const isDataUrl = values.packingListUrl.toLowerCase().startsWith('data:application/');
    const pdfAttached = Boolean(values.packingListUrl) && (isDataUrl || !pasteOpen);

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
            const reason = err?.message && !/fetch|network|malformed/i.test(err.message) ? err.message : '';
            setSaveError(reason || 'Couldn’t save. Check your connection and try again.');
            setSaving(false);
        }
    };

    const canDelete = isEdit && onDelete && currentUser?.permissions?.includes('delete_delivery_schedule');
    const deleteNow = async () => {
        setConfirmDelete(false);
        setSaving(true);
        try {
            await onDelete(initialData.id);
            onClose();
        } catch (err) {
            // deleteDelivery throws when the ticket wasn't deleted, so the form
            // stays open and says so instead of closing as if it had worked.
            console.error('[DeliveryForm] delete failed:', err);
            setSaveError(err?.userMessage || 'Couldn’t delete it. Try again.');
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
    const { transferOrigin, transferDestination, truckId, date, deliveryType, customerDropOff } = values;
    const branchOptions = useMemo(() => {
        const names = (locationsList || [])
            .map((loc) => (typeof loc === 'object' && loc ? (loc.name || loc.locationName || '') : String(loc || '')))
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));
        return [...new Set([...names, transferOrigin, transferDestination].filter(Boolean))].map((n) => ({ value: n, label: n }));
    }, [locationsList, transferOrigin, transferDestination]);
    // Already shaped by the shared rules: city under the name, contact searchable.
    const customerPickerOptions = customers;
    const drivers = useMemo(
        () => driverOptions(trucks, { truckId, date, deliveryType, customerDropOff }, { deliveries, exceptId: initialData?.id, max: MAX_TRUCK_CAPACITY }),
        [trucks, truckId, date, deliveryType, customerDropOff, deliveries, initialData?.id]
    );

    // ── Field helpers ──
    const text = (name, label, { required = false, placeholder, inputMode, asTyped = false, error, status, value, onChange, onBlur, inputType = 'text' } = {}) => {
        const id = `df-${name}`;
        return (
            <FormField name={name} id={id} label={label} required={required} error={error} status={status}>
                <input
                    id={id}
                    className={`fm-input${asTyped ? ' no-capitalize' : ''}`}
                    type={inputType}
                    inputMode={inputMode}
                    value={value ?? values[name] ?? ''}
                    placeholder={placeholder}
                    autoComplete="off"
                    autoCapitalize={asTyped ? undefined : 'words'}
                    onChange={onChange || ((e) => set({ [name]: e.target.value }))}
                    onBlur={onBlur}
                    {...describedBy(id, error, status)}
                />
            </FormField>
        );
    };
    const picker = (name, label, options, { required = false, placeholder, onChange, value, error, status } = {}) => (
        <FormField name={name} id={`df-${name}`} label={label} required={required} error={error} status={status}>
            <FormPicker
                id={`df-${name}`}
                value={value ?? values[name]}
                onChange={onChange || ((v) => set({ [name]: v }))}
                options={options}
                placeholder={placeholder}
                sheetTitle={label}
                error={error}
            />
        </FormField>
    );

    const dateField = text('date', dateLabelFor(values), {
        required: !pending,
        inputType: 'date',
        asTyped: true,
        error: shown('date'),
        // Weekend work is rare but real, so this informs rather than blocks.
        status: isWeekendDate(values.date) ? (
            <><AlertTriangle size={12} aria-hidden="true" />{`${dayLabel(values.date).name} — weekend ${isTransfer ? 'transfer' : type === 'jobsite' ? 'delivery' : 'pickup'}`}</>
        ) : null,
        onChange: (e) => setValues((v) => applyDateChange(v, e.target.value)),
        onBlur: () => touch('date')
    });

    const typeField = picker('deliveryType', 'Delivery type', DELIVERY_TYPE_OPTIONS, {
        onChange: (next) => setValues((v) => applyTypeChange(v, next, { isNew: !isEdit, thirdPartyTruckId: trucks.find(isThirdPartyTruck)?.id }))
    });

    const slabsField = text('numberOfSlabs', 'No. of slabs', {
        inputMode: 'numeric',
        asTyped: true,
        placeholder: '0',
        onChange: (e) => set({ numberOfSlabs: e.target.value.replace(/\D/g, '').slice(0, 4) })
    });

    const driverField = picker('truckId', 'Driver', drivers, {
        value: driverPickerValue(values),
        onChange: (picked) => setValues((v) => applyDriverPick(v, picked, initialData)),
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

            <FormSection>
                <FormRow>
                    {dateField}
                    {typeField}
                </FormRow>

                {isTransfer ? (
                    <>
                        <div className="df-pair">
                            {picker('transferOrigin', 'From', branchOptions, { required: true, placeholder: 'Pick a branch', error: shown('transferOrigin') })}
                            {picker('transferDestination', 'To', branchOptions, { required: true, placeholder: 'Pick a branch', error: shown('transferDestination') })}
                        </div>
                        <FormRow>
                            {text('expectedArrivalDate', 'Expected arrival', {
                                required: Boolean(values.date), inputType: 'date', asTyped: true, error: shown('expectedArrivalDate'),
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
                            {picker('salesRepName', 'Sales rep', repOptions(repNames, values.salesRepName))}
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
                <FormField name="packingList" id="df-packingList" label="Packing list">
                    <input ref={fileRef} type="file" accept=".pdf,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) attachFile(f); }} />
                    {pdfBusy ? (
                        <div className="df-drop" role="status"><span className="fm-spinner" aria-hidden="true" /><span className="df-drop-text">Attaching PDF…</span></div>
                    ) : pdfAttached ? (
                        <div className="df-file">
                            <FileText size={20} aria-hidden="true" />
                            <span className="df-file-text">
                                <b>{values.packingListFilename || 'Packing list.pdf'}</b>
                                <span className="df-file-ok">Attached</span>
                            </span>
                            {/* The signed copy only while this is still the packing list it was
                                signed on; a newly attached file opens itself. */}
                            <a
                                className="fm-btn fm-btn-small"
                                href={initialData?.pod?.signedPdfUrl && values.packingListUrl === initialData?.packingListUrl
                                    ? initialData.pod.signedPdfUrl
                                    : values.packingListUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                View
                            </a>
                            <button type="button" className="df-icon-btn" aria-label="Remove packing list" title="Remove" onClick={removePdf}>
                                <X size={16} aria-hidden="true" />
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="df-drop">
                                <FileText size={20} aria-hidden="true" />
                                <span className="df-drop-text">No PDF attached</span>
                                <button type="button" id="df-packingList" className="fm-btn fm-btn-small" onClick={() => fileRef.current?.click()}>
                                    <Upload size={15} aria-hidden="true" />Choose PDF
                                </button>
                                <button type="button" className="df-link" aria-expanded={pasteOpen} onClick={() => setPasteOpen((o) => !o)}>Paste a link</button>
                            </div>
                            {pasteOpen && (
                                <input
                                    className="fm-input no-capitalize"
                                    type="url"
                                    aria-label="Link to the packing list PDF"
                                    placeholder="https://"
                                    value={isDataUrl ? '' : values.packingListUrl}
                                    onChange={(e) => onPasteLink(e.target.value)}
                                />
                            )}
                        </>
                    )}
                    {autofill && values.packingListUrl && (
                        <div className="df-autofill" role="status">
                            {autofill.filled.length > 0 && (
                                <span className="df-autofill-ok">Filled in from the {autofill.source}: {autofill.filled.join(', ')}. Check them before saving.</span>
                            )}
                            {autofill.kept.map((k) => (
                                <span key={k.field} className="df-autofill-kept">
                                    <AlertTriangle size={12} aria-hidden="true" />
                                    {k.field} left as “{k.current}” — the {autofill.source} says “{k.pdf}”.
                                </span>
                            ))}
                        </div>
                    )}
                </FormField>
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
                <div
                    className="fm-confirm-backdrop"
                    onClick={(e) => { if (e.target === e.currentTarget) setConfirmDelete(false); }}
                    onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setConfirmDelete(false); } }}
                >
                    <div className="fm-confirm" role="alertdialog" aria-modal="true" aria-labelledby="df-delete-title" data-fm-layer="" tabIndex={-1}>
                        <h3 className="fm-confirm-title" id="df-delete-title">{`${wording.deleteLabel}?`}</h3>
                        <p className="fm-confirm-text">
                            {isTransfer ? `The ${wording.titleSub} transfer` : (initial.customerName || 'This ticket')} will be removed from the schedule. This can’t be undone.
                        </p>
                        <div className="fm-confirm-actions">
                            <button type="button" className="fm-btn" autoFocus onClick={() => setConfirmDelete(false)}>Cancel</button>
                            <button type="button" className="fm-btn fm-btn-danger" onClick={deleteNow}>Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </FormModal>
    );
}

// Only the fields this form has, from a draft saved by this form or by the old
// DeliveryModal (same names).
function pickKnown(draft, shape) {
    return Object.fromEntries(Object.keys(shape).filter((k) => draft[k] !== undefined).map((k) => {
        const v = draft[k];
        return [k, typeof shape[k] === 'string' && typeof v !== 'string' ? String(v ?? '') : v];
    }));
}
