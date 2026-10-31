import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormField } from '../../../components/shared/form/FormControls';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import { normalizeVisitDate } from '../../../utils/visitDates';
import type { Loose } from '../../../types/records';

type Fields = { expectedArrivalDate?: string; numberOfSlabs?: number };
export default function IncomingTransferForm({ ticket, onClose, onSave }: {
    ticket: Loose; onClose: () => void; onSave?: (id: string, fields: Fields) => Promise<unknown>;
}) {
    const initialDate = String(ticket.expectedArrivalDate || '').slice(0, 10);
    const initialSlabs = String(ticket.numberOfSlabs ?? 0);
    const [date, setDate] = useState(initialDate), [slabs, setSlabs] = useState(initialSlabs);
    const [saving, setSaving] = useState(false), [submitted, setSubmitted] = useState(false), [error, setError] = useState('');
    const dirty = Number(date !== initialDate) + Number(slabs !== initialSlabs);
    const shipDate = String(ticket.shipDate || ticket.date || '').slice(0, 10);
    const errors: Record<string, string> = {};
    if (date !== initialDate && (!normalizeVisitDate(date) || (shipDate && date < shipDate))) errors.expectedArrivalDate = 'Choose a date on or after the ship date';
    if (!/^\d+$/.test(slabs) || !Number.isSafeInteger(Number(slabs))) errors.numberOfSlabs = 'Enter a whole number of zero or more';
    const save = async (event: React.FormEvent) => {
        event.preventDefault(); setSubmitted(true);
        if (Object.keys(errors).length || !dirty) return;
        const fields: Fields = {};
        if (date !== initialDate) fields.expectedArrivalDate = date;
        if (slabs !== initialSlabs) fields.numberOfSlabs = Number(slabs);
        setSaving(true); setError('');
        try {
            if (!onSave) throw new Error('Incoming transfer updates are unavailable. Refresh and try again.');
            await onSave(String(ticket.id), fields); onClose();
        } catch (err) { setError((err as Error).message); }
        finally { setSaving(false); }
    };
    return <FormModal title="Update incoming transfer" size="s" onClose={onClose} onSubmit={save}
        submitLabel="Save changes" footerNote="Submitted Daily Reports must be reopened to reflect changes." saving={saving} dirtyCount={dirty} submitDisabled={!dirty}
        errors={errors} showErrors={submitted} fieldLabels={{ expectedArrivalDate: 'Expected delivery date', numberOfSlabs: 'Slab count' }}>
        <p>{ticket.location} → {ticket.transferDestination} · {ticket.customerName}</p>
        <p>The sending branch controls the driver and ship date. You can update the expected delivery date and slab count.</p>
        {error && <div role="alert">{error}</div>}
        <FormField name="expectedArrivalDate" id="incoming-eta" label="Expected delivery date" error={submitted ? errors.expectedArrivalDate : ''}>
            <DatePicker id="incoming-eta" value={date} onChange={setDate} clearable={false} sheetTitle="Expected delivery date" />
        </FormField>
        <FormField name="numberOfSlabs" id="incoming-slabs" label="Slab count" required error={submitted ? errors.numberOfSlabs : ''}>
            <input id="incoming-slabs" className="fm-input" inputMode="numeric" value={slabs} onChange={event => setSlabs(event.target.value)} />
        </FormField>
    </FormModal>;
}
