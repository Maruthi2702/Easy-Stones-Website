import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Camera, FileText, Trash2, X } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormRow, FormField, FormPicker, FormSearchPicker } from '../../../components/shared/form/FormControls';
import { goToField } from '../../../components/shared/form/formFocus';
import useTouched from '../../../components/shared/form/useTouched';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import { isPdfSource } from '../../../utils/attachments';
import {
    RESOURCE_FIELD_LABELS, RESOURCE_STATUSES, validateResourceValues, countResourceChanges, resourceValuesToSave
} from '../../../utils/resourceForm';
import type { ResourceValues } from '../../../utils/resourceForm';
import { useResourceTypes, typeOptions as buildTypeOptions } from '../../../api/typeLists';
import { attachmentSrc } from './attachmentSrc';
import './ResourceForm.css';

/*
 * Add resource / Edit resource on the shared form template (FORM_TEMPLATE.md),
 * size M. Design: "A · Forms" on the claude.ai artifact Resources Redesign
 * Canvas (https://claude.ai/artifact/TSMaMjGbsD5o1WDD7CYUiu): Customer, then
 * Resource type | Qty, Date | Status, then Description and Internal notes,
 * then the photos and PDFs. No headings, no helper text, no Cancel.
 * The rules are src/utils/resourceForm.ts.
 */

export type ResourceFormProps = {
    isEdit: boolean;
    values: ResourceValues;
    initial: ResourceValues;
    onChange: (patch: Partial<ResourceValues> & { customer?: string }) => void;
    /** Photos and PDFs on the resource (data: URLs until saved). */
    attachments: string[];
    /** How many attachments it opened with (a change counts as unsaved). */
    initialAttachmentCount: number;
    onUpload: (e: ChangeEvent<HTMLInputElement>) => void;
    onRemoveAttachment: (index: number) => void;
    customerOptions: { value: string; label: string; description?: string; keywords?: string }[];
    customersLoading?: boolean;
    customerLabel?: string;
    onCreateCustomer?: () => void;
    saving: boolean;
    onSave: (fields: ReturnType<typeof resourceValuesToSave>) => void;
    onClose: () => void;
    canDelete?: boolean;
    onDelete?: () => void;
    footerNote?: string;
};

export default function ResourceForm({
    isEdit, values, initial, onChange, attachments, initialAttachmentCount, onUpload, onRemoveAttachment, customerOptions,
    customersLoading = false, customerLabel = '', onCreateCustomer, saving, onSave, onClose, canDelete = false, onDelete, footerNote
}: ResourceFormProps) {
    const [touched, touchField, markTouched] = useTouched();
    const [submitted, setSubmitted] = useState(false);

    const errors = validateResourceValues(values);
    const shown = (field: string) => (errors[field] && (submitted || touched[field]) ? errors[field] : '');
    const dirtyCount = countResourceChanges(values, initial) + (attachments.length !== initialAttachmentCount ? 1 : 0);

    // The list is Admin → Resource Types, in the managers' order; a resource saved
    // with a type that's since been hidden still shows it.
    const resourceTypes = useResourceTypes();
    const typeOptions = useMemo(
        () => buildTypeOptions(resourceTypes.active, resourceTypes.types, values.resourceType),
        [resourceTypes.active, resourceTypes.types, values.resourceType]
    );

    const submit = () => {
        setSubmitted(true);
        const first = Object.keys(RESOURCE_FIELD_LABELS).find((k) => errors[k]);
        if (first) {
            goToField(first);
            return;
        }
        onSave(resourceValuesToSave(values));
    };

    const footerStart = isEdit && canDelete ? (
        <button
            type="button"
            className="fm-btn fm-btn-text-danger"
            disabled={saving || dirtyCount > 0}
            title={dirtyCount > 0 ? 'Save or discard your changes first' : 'Delete this resource'}
            onClick={onDelete}
        >
            <Trash2 size={16} aria-hidden="true" />
            Delete resource
        </button>
    ) : null;

    return (
        <FormModal
            title={isEdit ? <>Edit resource <span className="fm-title-sub">· {customerLabel || 'Resource'}</span></> : 'Add a resource'}
            size="m"
            onClose={onClose}
            onSubmit={submit}
            submitLabel={isEdit ? 'Save changes' : 'Add resource'}
            savingLabel="Saving…"
            saving={saving}
            submitDisabled={isEdit && dirtyCount === 0}
            dirtyCount={dirtyCount}
            discardTitle={isEdit ? 'Discard your changes?' : 'Discard this resource?'}
            errors={errors}
            showErrors={submitted}
            fieldLabels={RESOURCE_FIELD_LABELS}
            footerStart={footerStart}
            footerNote={isEdit ? footerNote : null}
        >
            <FormSection>
                <FormField name="customerId" id="rf-customer" label="Customer" required error={shown('customerId')}>
                    <FormSearchPicker
                        id="rf-customer"
                        value={values.customerId}
                        onChange={(v) => {
                            const option = customerOptions.find((o) => o.value === v);
                            onChange({ customerId: v, customer: option ? String(option.label) : '' });
                            markTouched('customerId');
                        }}
                        options={customerOptions}
                        loading={customersLoading && customerOptions.length === 0}
                        selectedLabel={customerLabel}
                        placeholder="Search customers"
                        sheetTitle="Customer"
                        onCreateNew={onCreateCustomer}
                        createNewLabel="New customer"
                        error={shown('customerId')}
                    />
                </FormField>
                <FormRow>
                    <FormField name="resourceType" id="rf-type" label="Resource type" required error={shown('resourceType')}>
                        <FormPicker
                            id="rf-type"
                            value={values.resourceType}
                            onChange={(v) => { onChange({ resourceType: v }); markTouched('resourceType'); }}
                            options={typeOptions}
                            placeholder="Choose a type"
                            sheetTitle="Resource type"
                            error={shown('resourceType')}
                        />
                    </FormField>
                    <FormField name="qty" id="rf-qty" label="Qty" required error={shown('qty')}>
                        <input
                            id="rf-qty"
                            className="fm-input"
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            value={values.qty}
                            aria-invalid={Boolean(shown('qty'))}
                            onChange={(e) => onChange({ qty: e.target.value.replace(/[^\d]/g, '') })}
                            onBlur={() => touchField('qty', values.qty !== initial.qty)}
                        />
                    </FormField>
                </FormRow>
                <FormRow>
                    <FormField name="date" id="rf-date" label="Date" required error={shown('date')}>
                        <DatePicker
                            id="rf-date"
                            value={values.date}
                            onChange={(date: string) => onChange({ date })}
                            onBlur={() => touchField('date', values.date !== initial.date)}
                            error={shown('date')}
                            sheetTitle="Date"
                        />
                    </FormField>
                    <FormField name="status" id="rf-status" label="Status">
                        <FormPicker
                            id="rf-status"
                            value={values.status}
                            onChange={(v) => onChange({ status: v })}
                            options={RESOURCE_STATUSES}
                            sheetTitle="Status"
                        />
                    </FormField>
                </FormRow>
            </FormSection>

            <FormSection>
                <FormField name="description" id="rf-description" label="Description">
                    <textarea
                        id="rf-description"
                        className="fm-input"
                        rows={3}
                        autoCapitalize="sentences"
                        value={values.description}
                        placeholder="What was left, and where"
                        onChange={(e) => onChange({ description: e.target.value })}
                    />
                </FormField>
                <FormField name="notes" id="rf-notes" label="Internal notes">
                    <textarea
                        id="rf-notes"
                        className="fm-input"
                        rows={2}
                        autoCapitalize="sentences"
                        value={values.notes}
                        onChange={(e) => onChange({ notes: e.target.value })}
                    />
                </FormField>
            </FormSection>

            <FormSection>
                <div className="fm-field">
                    <span className="fm-label" id="rf-files-label">Photos and PDFs</span>
                    <div className="rf-tiles">
                        {attachments.map((src, idx) => (
                            <div key={idx} className="rf-tile">
                                {isPdfSource(src) ? (
                                    <><FileText size={22} aria-hidden="true" />PDF</>
                                ) : (
                                    <img src={attachmentSrc(src)} alt={`Attachment ${idx + 1}`} loading="lazy" />
                                )}
                                <button type="button" className="rf-tile-rm" aria-label={`Remove attachment ${idx + 1}`} onClick={() => onRemoveAttachment(idx)}>
                                    <X size={12} strokeWidth={2.6} aria-hidden="true" />
                                </button>
                            </div>
                        ))}
                        <label className="rf-add">
                            <input
                                className="rf-file-input"
                                type="file"
                                accept="image/*,application/pdf"
                                multiple
                                aria-labelledby="rf-files-label"
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
        </FormModal>
    );
}
