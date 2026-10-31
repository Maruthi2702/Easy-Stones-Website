import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormField, FormSection, SegmentedToggle } from '../../../components/shared/form/FormControls';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import { formatDateText } from '../../../components/shared/calendar/calendarDates';
import { FOLLOW_UP_OUTCOME_MAX, followUpNote, snoozeChoices } from '../../../utils/followUpList';
import type { FollowUpRow } from '../../../utils/followUpList';

const customerOf = (row: FollowUpRow) => row.company || row.customerName || 'Customer';

/** Snooze: move a follow-up's due day to tomorrow, Monday, next week or any later day. */
export function SnoozeDialog({ row, today, onSnooze, onClose }: {
    row: FollowUpRow;
    today: string;
    /** Resolves true once saved (the dialog then closes). */
    onSnooze: (until: string) => Promise<boolean>;
    onClose: () => void;
}) {
    const choices = snoozeChoices(today);
    const [until, setUntil] = useState(choices[0].value);
    const [saving, setSaving] = useState(false);
    const quick = choices.find((c) => c.value === until)?.value ?? '';
    return (
        <FormModal
            title="Snooze until…"
            size="s"
            onClose={onClose}
            onSubmit={async () => {
                setSaving(true);
                const ok = await onSnooze(until);
                setSaving(false);
                if (ok) onClose();
            }}
            submitLabel={`Snooze to ${formatDateText(until)}`}
            savingLabel="Snoozing…"
            saving={saving}
            submitDisabled={!until}
        >
            <FormSection>
                <p className="fu-dialog-sub"><strong>{customerOf(row)}</strong>{followUpNote(row) ? ` · ${followUpNote(row)}` : ''}</p>
                <SegmentedToggle label="Snooze until" value={quick} onChange={setUntil} options={choices.map((c) => ({ value: c.value, label: c.label }))} />
                <FormField id="fu-snooze-day" label="Or pick a day">
                    <DatePicker id="fu-snooze-day" value={until} onChange={(v) => v && setUntil(v)} min={today} today={today} sheetTitle="Snooze until" />
                </FormField>
            </FormSection>
        </FormModal>
    );
}

/** What happened: a note on a follow-up that's been ticked done. */
export function OutcomeDialog({ row, onSave, onClose }: {
    row: FollowUpRow;
    onSave: (outcome: string) => Promise<boolean>;
    onClose: () => void;
}) {
    const [outcome, setOutcome] = useState(String(row.followUpOutcome || ''));
    const [saving, setSaving] = useState(false);
    const dirty = outcome.trim() !== String(row.followUpOutcome || '').trim();
    return (
        <FormModal
            title="What happened?"
            size="s"
            onClose={onClose}
            onSubmit={async () => {
                setSaving(true);
                const ok = await onSave(outcome.trim());
                setSaving(false);
                if (ok) onClose();
            }}
            submitLabel="Save"
            savingLabel="Saving…"
            saving={saving}
            dirtyCount={dirty ? 1 : 0}
        >
            <FormSection>
                <p className="fu-dialog-sub"><strong>{customerOf(row)}</strong>{followUpNote(row) ? ` · ${followUpNote(row)}` : ''}</p>
                <FormField id="fu-outcome" label="What happened">
                    <textarea
                        id="fu-outcome"
                        className="fm-input fm-textarea"
                        rows={4}
                        maxLength={FOLLOW_UP_OUTCOME_MAX}
                        value={outcome}
                        onChange={(e) => setOutcome(e.target.value)}
                    />
                </FormField>
            </FormSection>
        </FormModal>
    );
}
