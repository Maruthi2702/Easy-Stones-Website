import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormRow, FormField } from '../../../components/shared/form/FormControls';
import { goToField } from '../../../components/shared/form/formFocus';
import { formatPhoneInput } from '../../../utils/phoneUtils';
import type { ContactForm } from '../useCustomerActions';

export type ContactModalProps = {
    form: ContactForm;
    onChange: (form: ContactForm) => void;
    isEditing: boolean;
    isSaving: boolean;
    onSave: () => void;
    onClose: () => void;
};

const FIELDS: (keyof ContactForm)[] = ['name', 'phone', 'email', 'role', 'notes'];
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Customer profile → Add / Edit contact, on the form template (FORM_TEMPLATE.md, size S):
 * title in the header, ✕ with the unsaved-changes check instead of Cancel, one main button,
 * Save changes greyed out until something changes. The parent still holds the values.
 */
export default function ContactModal({ form, onChange, isEditing, isSaving, onSave, onClose }: ContactModalProps) {
    // What the form opened with, for the change count and the edit form's Save changes.
    const [initial] = useState(form);
    const [submitted, setSubmitted] = useState(false);
    const set = (patch: Partial<ContactForm>) => onChange({ ...form, ...patch });

    const errors: Record<string, string> = {
        name: form.name.trim() ? '' : 'Enter the contact’s name.',
        email: form.email.trim() && !EMAIL_SHAPE.test(form.email.trim()) ? 'Enter a valid email address.' : ''
    };
    const firstError = (['name', 'email'] as const).find((k) => errors[k]);
    const changed = FIELDS.filter((k) => form[k] !== initial[k]).length;

    const submit = () => {
        setSubmitted(true);
        if (firstError) { goToField(firstError); return; }
        onSave();
    };

    return (
        <FormModal
            title={isEditing ? <>Edit contact{initial.name ? <span className="fm-title-sub"> · {initial.name}</span> : null}</> : 'Add a contact'}
            size="s"
            onClose={onClose}
            onSubmit={submit}
            submitLabel={isEditing ? 'Save changes' : 'Add contact'}
            saving={isSaving}
            submitDisabled={isEditing && changed === 0}
            dirtyCount={changed}
            errors={submitted ? errors : {}}
            showErrors={submitted}
            fieldLabels={{ name: 'Name', email: 'Email' }}
        >
            <FormSection>
                <FormField name="name" id="ct-name" label="Name" required error={submitted ? errors.name : ''}>
                    <input id="ct-name" className="fm-input" type="text" value={form.name} disabled={isSaving} autoCapitalize="words"
                        onChange={(e) => set({ name: e.target.value })} />
                </FormField>
                <FormRow>
                    <FormField name="phone" id="ct-phone" label="Phone">
                        <input id="ct-phone" className="fm-input" type="tel" inputMode="tel" value={form.phone} disabled={isSaving}
                            placeholder="(555) 000-0000" onChange={(e) => set({ phone: formatPhoneInput(e.target.value) })} />
                    </FormField>
                    <FormField name="email" id="ct-email" label="Email" error={submitted ? errors.email : ''}>
                        <input id="ct-email" className="fm-input" type="email" value={form.email} disabled={isSaving} autoCapitalize="off"
                            onChange={(e) => set({ email: e.target.value })} />
                    </FormField>
                </FormRow>
                <FormField name="role" id="ct-role" label="Role">
                    <input id="ct-role" className="fm-input" type="text" value={form.role} disabled={isSaving} autoCapitalize="words"
                        placeholder="Job title" onChange={(e) => set({ role: e.target.value })} />
                </FormField>
                <FormField name="notes" id="ct-notes" label="Notes">
                    <textarea id="ct-notes" className="fm-input" rows={3} value={form.notes} disabled={isSaving} autoCapitalize="sentences"
                        onChange={(e) => set({ notes: e.target.value })} />
                </FormField>
            </FormSection>
        </FormModal>
    );
}
