import { useState } from 'react';
import FormModal from '../../components/shared/form/FormModal';
import { FormField, FormPicker, SegmentedToggle } from '../../components/shared/form/FormControls';
import { goToField } from '../../components/shared/form/formFocus';
import { typeOptions, useResourceFamilies } from '../../api/typeLists';
import type { ResourceFamily, TypeInput, TypeListKind, TypeRecord, VisitFields } from '../../api/typeLists';
import { NAME_MAX, DEFAULT_VISIT_FIELDS, OTHER_FAMILY } from '../../utils/typeLists';
import { COPY, FOLLOW_UP_CHOICES } from './typeListView';

/*
 * Add / Edit a visit type, a resource type or a family, on the form template
 * (FORM_TEMPLATE.md), size S. The name staff read is the only name that can be
 * changed: what records store stays as it was, so history, filters and the
 * calendar keep matching.
 */

const ON_OFF = [{ value: 'on', label: 'Shown' }, { value: 'off', label: 'Hidden' }] as const;

export type TypeFormProps = {
    kind: TypeListKind;
    /** The type being edited; none = a new one. */
    type?: TypeRecord | null;
    /** Saves, or throws with the reason to show. */
    onSave: (input: TypeInput) => Promise<unknown>;
    onClose: () => void;
};

export default function TypeForm({ kind, type = null, onSave, onClose }: TypeFormProps) {
    const copy = COPY[kind];
    const editing = Boolean(type);
    const [label, setLabel] = useState(type?.label || '');
    const [family, setFamily] = useState<ResourceFamily>(type?.family || OTHER_FAMILY);
    const families = useResourceFamilies();
    // The shown families, plus the one this type already has if it's hidden.
    const familyChoices = typeOptions(families.active, families.types, type?.family);
    const [fields, setFields] = useState<VisitFields>(type?.fields || { ...DEFAULT_VISIT_FIELDS } as VisitFields);
    const [submitted, setSubmitted] = useState(false);
    const [saving, setSaving] = useState(false);
    const [serverError, setServerError] = useState('');

    const trimmed = label.trim();
    const nameError = !trimmed ? 'Enter a name' : trimmed.length > NAME_MAX ? `At most ${NAME_MAX} characters` : serverError;
    const errors = { label: submitted ? nameError : serverError };

    const dirty = editing
        ? [trimmed !== type?.label, kind === 'resource' && family !== (type?.family || OTHER_FAMILY),
            kind === 'visit' && JSON.stringify(fields) !== JSON.stringify(type?.fields)].filter(Boolean).length
        : [trimmed, kind === 'resource' && family !== OTHER_FAMILY].filter(Boolean).length;

    const submit = async () => {
        setSubmitted(true);
        setServerError('');
        if (!trimmed || trimmed.length > NAME_MAX) { goToField('label'); return; }
        setSaving(true);
        try {
            await onSave(kind === 'resource' ? { label: trimmed, family } : kind === 'visit' ? { label: trimmed, fields } : { label: trimmed });
            onClose();
        } catch (error) {
            setServerError((error as Error).message || 'Could not save');
            goToField('label');
        } finally {
            setSaving(false);
        }
    };

    const setField = <K extends keyof VisitFields>(key: K, value: VisitFields[K]) => setFields((f) => ({ ...f, [key]: value }));

    return (
        <FormModal
            title={`${editing ? 'Edit' : 'Add'} ${copy.noun}`}
            size="s"
            onClose={onClose}
            onSubmit={(e) => { e.preventDefault(); submit(); }}
            submitLabel={editing ? 'Save changes' : `Add ${copy.noun}`}
            saving={saving}
            submitDisabled={editing && dirty === 0}
            dirtyCount={dirty}
            errors={errors}
            showErrors={submitted || Boolean(serverError)}
            fieldLabels={{ label: 'Name' }}
        >
            <FormField name="label" id="tl-label" label="Name" required error={errors.label}>
                <input
                    id="tl-label"
                    className="fm-input"
                    value={label}
                    maxLength={NAME_MAX + 20}
                    onChange={(e) => { setLabel(e.target.value); setServerError(''); }}
                    aria-invalid={errors.label ? 'true' : undefined}
                    aria-describedby={errors.label ? 'tl-label-msg' : undefined}
                    autoComplete="off"
                />
            </FormField>

            {kind === 'resource' && (
                <FormField name="family" id="tl-family" label="Family">
                    <FormPicker
                        id="tl-family"
                        value={family}
                        onChange={(v) => setFamily(v as ResourceFamily)}
                        options={familyChoices}
                        sheetTitle="Family"
                    />
                </FormField>
            )}

            {kind === 'visit' && (
                <>
                    <FormField name="notes" id="tl-notes" label="Notes">
                        <SegmentedToggle label="Notes" value={fields.notes ? 'on' : 'off'} onChange={(v) => setField('notes', v === 'on')} options={[...ON_OFF]} />
                    </FormField>
                    <FormField name="outcome" id="tl-outcome" label="Outcome">
                        <SegmentedToggle label="Outcome" value={fields.outcome ? 'on' : 'off'} onChange={(v) => setField('outcome', v === 'on')} options={[...ON_OFF]} />
                    </FormField>
                    <FormField name="followUp" id="tl-followup" label="Follow-up">
                        <SegmentedToggle label="Follow-up" value={fields.followUp} onChange={(v) => setField('followUp', v)} options={[...FOLLOW_UP_CHOICES]} />
                    </FormField>
                </>
            )}
        </FormModal>
    );
}
