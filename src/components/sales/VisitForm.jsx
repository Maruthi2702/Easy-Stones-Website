import React, { useMemo, useState } from 'react';
import { Camera, FileText, Trash2, X } from 'lucide-react';
import FormModal from '../shared/form/FormModal';
import { FormSection, FormRow, FormField, FormPicker, FormSearchPicker, SegmentedToggle } from '../shared/form/FormControls';
import { goToField, describedBy } from '../shared/form/formFocus';
import useTouched from '../shared/form/useTouched';
import { API_URL } from '../../config/api';
import { isPdfSource } from '../../utils/attachments';
import {
    VISIT_TYPES, FIELD_LABELS, visitFieldsFor, validateVisitValues, countVisitChanges, visitLastChangedText,
    followUpShown, visitValuesToSave
} from '../../utils/visitForm';
import './VisitForm.css';

/*
 * Add visit / Edit visit, on the shared form template (FORM_TEMPLATE.md),
 * size M. Approved design: model C on the "Add & Edit Visit" canvas
 * (claude.ai/artifact/UPcjj89doxCRsubhTrDZfN) — no section headings, a large
 * Notes box, follow-up only when asked for, attachments on one row, no
 * Cancel button (the ✕ closes, with the unsaved-changes check).
 *
 * The values live in SalesPage's visitForm (it saves them); VisitModal keeps
 * the starting snapshot and the follow-up toggle so they survive the form
 * being set aside while Add customer is open. Which fields a visit type uses
 * is src/utils/visitForm.js.
 */

const resolveImageSrc = (img) => {
    if (!img) return '';
    if (img.startsWith('data:') || img.startsWith('http')) return img;
    if (img.startsWith('/uploads')) return `${API_URL}${img}`;
    return `${API_URL}/uploads/visits/${img}`;
};

export default function VisitForm({
    isEdit,
    visit,
    values,
    setValues,
    initial,
    followUpOn,
    onFollowUpChange,
    customerOptions = [],
    customersLoading = false,
    customerLabel = '',
    saving,
    onSave,
    onClose,
    onUpload,
    onRemoveImage,
    onCreateCustomer,
    canDelete = false,
    onDelete
}) {
    const [touched, touchField, markTouched] = useTouched();
    const [submitted, setSubmitted] = useState(false);

    const set = (patch) => setValues((v) => ({ ...v, ...patch }));
    const touch = (field) => touchField(field, String(values[field] ?? '') !== String(initial[field] ?? ''));

    const errors = validateVisitValues(values);
    const shown = (field) => (errors[field] && (submitted || touched[field]) ? errors[field] : '');
    const visibleErrors = Object.fromEntries(Object.keys(FIELD_LABELS).filter((k) => errors[k]).map((k) => [k, errors[k]]));
    const dirtyCount = countVisitChanges(values, initial);

    const fields = visitFieldsFor(values.purpose);
    const showFollowUpFields = followUpShown(values.purpose, followUpOn);

    // Already shaped by the shared rules (src/utils/customerOptions.js): the
    // city under the name, and the contact and city searchable.
    const customers = customerOptions;
    // A visit saved with a type that's since left the list still shows it.
    const typeOptions = useMemo(
        () => (values.purpose && !VISIT_TYPES.some((t) => t.value === values.purpose)
            ? [{ value: values.purpose, label: values.purpose }, ...VISIT_TYPES]
            : VISIT_TYPES),
        [values.purpose]
    );
    const images = Array.isArray(values.image) ? values.image : (values.image ? [values.image] : []);

    const submit = () => {
        setSubmitted(true);
        const first = Object.keys(FIELD_LABELS).find((k) => errors[k]);
        if (first) {
            goToField(first);
            return;
        }
        // Hidden follow-up fields are cleared, not saved (visitValuesToSave).
        onSave(visitValuesToSave(values, followUpOn));
    };

    const textarea = (name, label, { placeholder, rows = 3, large = false } = {}) => (
        <FormField name={name} id={`vf-${name}`} label={label}>
            <textarea
                id={`vf-${name}`}
                className={`fm-input${large ? ' vf-notes' : ''}`}
                rows={rows}
                value={values[name] || ''}
                placeholder={placeholder}
                autoCapitalize="sentences"
                onChange={(e) => set({ [name]: e.target.value })}
            />
        </FormField>
    );

    const footerStart = isEdit && canDelete ? (
        <button
            type="button"
            className="fm-btn fm-btn-text-danger"
            disabled={saving || dirtyCount > 0}
            title={dirtyCount > 0 ? 'Save or discard your changes first' : 'Delete this visit'}
            onClick={onDelete}
        >
            <Trash2 size={16} aria-hidden="true" />
            Delete visit
        </button>
    ) : null;

    return (
        <FormModal
            title={isEdit ? <>Edit visit <span className="fm-title-sub">· {customerLabel || 'Visit'}</span></> : 'Add a visit'}
            size="m"
            onClose={onClose}
            onSubmit={submit}
            submitLabel={isEdit ? 'Save changes' : 'Add visit'}
            savingLabel="Saving…"
            saving={saving}
            submitDisabled={isEdit && dirtyCount === 0}
            dirtyCount={dirtyCount}
            discardTitle={isEdit ? 'Discard your changes?' : 'Discard this visit?'}
            errors={visibleErrors}
            showErrors={submitted}
            fieldLabels={FIELD_LABELS}
            footerStart={footerStart}
            footerNote={isEdit ? visitLastChangedText(visit || {}) : null}
        >
            <FormSection>
                <FormField name="customerId" id="vf-customer" label="Customer" required error={shown('customerId')}>
                    <FormSearchPicker
                        id="vf-customer"
                        value={values.customerId || ''}
                        onChange={(v) => { set({ customerId: v }); markTouched('customerId'); }}
                        options={customers}
                        loading={customersLoading && customers.length === 0}
                        selectedLabel={customerLabel}
                        placeholder="Search customers"
                        sheetTitle="Customer"
                        onCreateNew={onCreateCustomer}
                        createNewLabel="New customer"
                        error={shown('customerId')}
                    />
                </FormField>
                <FormRow>
                    <FormField name="purpose" id="vf-purpose" label="Visit type" required error={shown('purpose')}>
                        <FormPicker
                            id="vf-purpose"
                            value={values.purpose || ''}
                            onChange={(v) => { set({ purpose: v }); markTouched('purpose'); }}
                            options={typeOptions}
                            placeholder="Choose a visit type"
                            sheetTitle="Visit type"
                            error={shown('purpose')}
                        />
                    </FormField>
                    <FormField name="date" id="vf-date" label="Date" required error={shown('date')}>
                        <input
                            id="vf-date"
                            className="fm-input"
                            type="date"
                            value={values.date || ''}
                            onChange={(e) => set({ date: e.target.value })}
                            onBlur={() => touch('date')}
                            {...describedBy('vf-date', shown('date'))}
                        />
                    </FormField>
                </FormRow>

                {fields.notes && textarea('notes', 'Notes', { placeholder: 'What did you talk about?', rows: 5, large: true })}
                {fields.outcome && textarea('outcome', 'Outcome', { placeholder: 'What was agreed, quoted or ordered?' })}

                {fields.followUpToggle && (
                    <div className="fm-field">
                        <span className="fm-label" id="vf-followup-label">Follow-up</span>
                        <SegmentedToggle
                            label="Follow-up"
                            value={followUpOn ? 'on' : 'off'}
                            onChange={(v) => onFollowUpChange(v === 'on')}
                            options={[{ value: 'off', label: 'No follow-up' }, { value: 'on', label: 'Set a follow-up' }]}
                        />
                    </div>
                )}
                {showFollowUpFields && (
                    <FormRow>
                        <FormField name="followUpDate" id="vf-followUpDate" label="Follow-up date">
                            <input
                                id="vf-followUpDate"
                                className="fm-input"
                                type="date"
                                value={values.followUpDate || ''}
                                onChange={(e) => set({ followUpDate: e.target.value })}
                            />
                        </FormField>
                        {textarea('followUp', 'Follow-up notes', { placeholder: 'What happens next?' })}
                    </FormRow>
                )}

                <div className="fm-field">
                    <span className="fm-label" id="vf-files-label">Attachments</span>
                    <div className="vf-tiles">
                        {images.map((img, idx) => (
                            <div key={idx} className="vf-tile">
                                {isPdfSource(img) ? (
                                    <><FileText size={22} aria-hidden="true" />PDF</>
                                ) : (
                                    <img src={resolveImageSrc(img)} alt={`Attachment ${idx + 1}`} loading="lazy" />
                                )}
                                <button type="button" className="vf-tile-rm" aria-label={`Remove attachment ${idx + 1}`} onClick={() => onRemoveImage(idx)}>
                                    <X size={12} strokeWidth={2.6} aria-hidden="true" />
                                </button>
                            </div>
                        ))}
                        <label className="vf-add">
                            <input
                                className="vf-file-input"
                                type="file"
                                accept="image/*,application/pdf"
                                multiple
                                aria-labelledby="vf-files-label"
                                onChange={(e) => {
                                    onUpload(e);
                                    // onUpload has read the files; clear so the same file can be picked again.
                                    e.target.value = '';
                                }}
                            />
                            <Camera size={18} aria-hidden="true" />
                            Add photos or PDFs
                        </label>
                    </div>
                </div>
            </FormSection>

            {isEdit && (
                <FormSection>
                    <FormRow>
                        <FormField name="managerComment" id="vf-managerComment" label="Manager comment">
                            <input
                                id="vf-managerComment"
                                className="fm-input"
                                type="text"
                                autoCapitalize="sentences"
                                value={values.managerComment || ''}
                                onChange={(e) => set({ managerComment: e.target.value })}
                            />
                        </FormField>
                        <FormField name="headquartersComment" id="vf-headquartersComment" label="Headquarters comment">
                            <input
                                id="vf-headquartersComment"
                                className="fm-input"
                                type="text"
                                autoCapitalize="sentences"
                                value={values.headquartersComment || ''}
                                onChange={(e) => set({ headquartersComment: e.target.value })}
                            />
                        </FormField>
                    </FormRow>
                </FormSection>
            )}
        </FormModal>
    );
}
