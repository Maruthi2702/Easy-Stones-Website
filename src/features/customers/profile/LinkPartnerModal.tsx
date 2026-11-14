import type { FormEvent } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormField, FormSearchPicker } from '../../../components/shared/form/FormControls';
import './LinkPartnerModal.css';

export type LinkPartnerModalProps = {
    /** Customers that can be linked (not this one, not already linked). */
    options: { value: string; label: string; description?: string; keywords?: string }[];
    value: string;
    onChange: (partnerId: string) => void;
    loading: boolean;
    /** Why the last try failed; shown under the field. */
    error?: string;
    linking: boolean;
    onSubmit: (e?: FormEvent) => void;
    onClose: () => void;
};

/**
 * Customer profile → Network → Link a partner. On the form template
 * (FORM_TEMPLATE.md, size S): title only, no Cancel (the ✕ closes), the main
 * button names the action and waits for a pick. The list is the shared
 * customer list (name, then type · city) in FormSearchPicker.
 *
 * Opens short; on desktop / tablet the window grows downward when the list
 * opens (LinkPartnerModal.css; `keepInForm` keeps the list from becoming a
 * bottom sheet, owner 2026-11-02). Phones use the full-screen form and the
 * picker's bottom sheet as usual.
 */
export default function LinkPartnerModal({ options, value, onChange, loading, error = '', linking, onSubmit, onClose }: LinkPartnerModalProps) {
    return (
        <FormModal
            title="Link a partner"
            size="s"
            onClose={onClose}
            onSubmit={(e) => { e.preventDefault(); onSubmit(e); }}
            submitLabel="Link partner"
            savingLabel="Linking…"
            saving={linking}
            submitDisabled={!value}
            // Closing with a partner picked but not linked asks first.
            dirtyCount={value ? 1 : 0}
        >
            <div className="lp-room">
                <FormField name="partner" id="link-partner" label="Partner" required error={error}>
                    <FormSearchPicker
                        id="link-partner"
                        value={value}
                        onChange={onChange}
                        options={options}
                        loading={loading}
                        placeholder="Search by company or contact name"
                        searchPlaceholder="Search customers"
                        sheetTitle="Select partner"
                        error={error}
                        keepInForm
                    />
                </FormField>
            </div>
        </FormModal>
    );
}
