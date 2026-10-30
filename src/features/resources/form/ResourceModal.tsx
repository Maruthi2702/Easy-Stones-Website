import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { formatForDateInput } from '../../../utils/dateUtils';
import { resourceValuesFrom } from '../../../utils/resourceForm';
import type { ResourceValues } from '../../../utils/resourceForm';
import type { Loose } from '../../../types/records';
import ResourceForm from './ResourceForm';
import ResourceView from './ResourceView';
import { attachmentList } from './attachmentSrc';

export type ResourceModalProps = {
    open: boolean;
    viewing: boolean;
    /** The saved resource being viewed or edited (null for a new one). */
    record: Loose | null;
    /** What the form holds (useResourceEditor's resourceForm). */
    form: Loose;
    setForm: (update: (prev: Loose) => Loose) => void;
    customerOptions: { value: string; label: string; description?: string; keywords?: string }[];
    customersLoading?: boolean;
    saving: boolean;
    onSave: (fields: Loose) => void;
    onClose: () => void;
    onUpload: (e: ChangeEvent<HTMLInputElement>) => void;
    onRemoveAttachment: (index: number) => void;
    onCreateCustomer?: () => void;
    onOpenGallery: (images: string[], index: number) => void;
    onDownload: (file: Loose) => void;
    onEditFromView: () => void;
    onOpenCustomer?: (customerId: string) => void;
    canEdit: boolean;
    canDelete: boolean;
    onDelete: () => void;
    /** True while Add customer is open on top: the form steps aside and comes back as it was. */
    suspended?: boolean;
};

/**
 * The resource window: View (read-only) or the Add / Edit form. Keeps where
 * the form started, for Save changes and the discard check, so it survives
 * the form stepping aside for Add customer.
 */
export default function ResourceModal(p: ResourceModalProps) {
    const today = formatForDateInput(new Date());
    const formOpen = p.open && !p.viewing;
    const [session, setSession] = useState<{ initial: ResourceValues; files: number } | null>(null);
    if (formOpen && !session) setSession({ initial: resourceValuesFrom(p.form, today), files: attachmentList(p.form.image).length });
    if (!formOpen && session) setSession(null);

    if (!p.open) return null;

    const customerId = String(p.form.customerId || p.record?.customerId || '');
    const option = p.customerOptions.find((o) => o.value === customerId);
    const customerLabel = String(option?.label || p.form.customer || p.record?.customerName || '');

    if (p.viewing) {
        const resource = { ...(p.record || {}), ...p.form };
        return (
            <ResourceView
                resource={resource}
                customerLabel={customerLabel}
                onClose={p.onClose}
                onEdit={p.canEdit ? p.onEditFromView : undefined}
                onDelete={p.canDelete ? p.onDelete : undefined}
                onOpenCustomer={p.onOpenCustomer && customerId ? () => p.onOpenCustomer?.(customerId) : undefined}
                onOpenGallery={p.onOpenGallery}
                onDownload={p.onDownload}
            />
        );
    }

    if (p.suspended || !session) return null;
    const isEdit = Boolean(p.record?._id);
    return (
        <ResourceForm
            isEdit={isEdit}
            values={resourceValuesFrom(p.form, today)}
            initial={session.initial}
            onChange={(patch) => p.setForm((prev) => ({ ...prev, ...patch }))}
            attachments={attachmentList(p.form.image)}
            initialAttachmentCount={session.files}
            onUpload={p.onUpload}
            onRemoveAttachment={p.onRemoveAttachment}
            customerOptions={p.customerOptions}
            customersLoading={p.customersLoading}
            customerLabel={customerLabel}
            onCreateCustomer={p.onCreateCustomer}
            saving={p.saving}
            onSave={p.onSave}
            onClose={p.onClose}
            canDelete={isEdit && p.canDelete}
            onDelete={p.onDelete}
            footerNote={p.record?.uploadedByName ? `Logged by ${p.record.uploadedByName}` : undefined}
        />
    );
}
