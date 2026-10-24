import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormField } from '../../../components/shared/form/FormControls';
import {
    deleteTitle, namesToShow, needsTypedCount, typedCountMatches
} from '../../../utils/customerBulkDelete';
import type { Loose } from '../../../types/records';

export type BulkDeleteDialogProps = {
    rows?: Loose[];
    saving?: boolean;
    error?: string;
    onConfirm: () => void;
    onClose: () => void;
};

/**
 * The bulk bar's Delete confirmation, on the form template: how many and
 * which (the first five names), and — above 10 — the count typed back before
 * Delete unlocks, so a select-all can't be thrown away with one stray click.
 * Every deleted customer is saved first and the bar offers Undo afterwards
 * (src/utils/customerBulkDelete.js, src/routes/customerBulkDelete.js).
 */
export default function BulkDeleteDialog({ rows = [], saving = false, error = '', onConfirm, onClose }: BulkDeleteDialogProps) {
    const count = rows.length;
    const [typed, setTyped] = useState('');
    const askCount = needsTypedCount(count);
    const ready = !askCount || typedCountMatches(typed, count);
    const { names, more } = namesToShow(rows.map((r) => r.company || r.contactName || r.name));

    return (
        <FormModal
            title={deleteTitle(count)}
            size="s"
            onClose={onClose}
            onSubmit={() => { if (ready) onConfirm(); }}
            submitLabel={count === 1 ? 'Delete customer' : `Delete ${count} customers`}
            savingLabel="Deleting…"
            saving={saving}
            submitDisabled={!ready}
            submitTone="danger"
        >
            {error && (
                <div className="fm-banner" role="alert">
                    <AlertCircle size={16} aria-hidden="true" />
                    <span className="fm-banner-text">{error}</span>
                </div>
            )}
            <FormSection>
                <ul className="cl-del-names">
                    {names.map((n, i) => <li key={`${n}-${i}`}>{n}</li>)}
                    {more > 0 && <li className="cl-del-more">and {more} more</li>}
                </ul>
                <p className="cl-del-note">
                    Their visits and resources go with them. You can undo this from the bar straight after.
                </p>
                {askCount && (
                    <FormField name="confirmCount" id="cl-del-count" label={`Type ${count} to confirm`} required>
                        <input
                            id="cl-del-count"
                            className="fm-input no-capitalize"
                            inputMode="numeric"
                            autoComplete="off"
                            value={typed}
                            onChange={(e) => setTyped(e.target.value)}
                        />
                    </FormField>
                )}
            </FormSection>
        </FormModal>
    );
}
