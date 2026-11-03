import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormField, FormPicker } from '../../../components/shared/form/FormControls';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import { normalizeVisitDate } from '../../../utils/visitDates';
import { STATUS_OPTIONS } from '../../../utils/deliveryForm';
import { isReceivingStatus, receivingStatusRefusal } from '../../../utils/transferAccess';
import type { Loose } from '../../../types/records';

type Fields = { expectedArrivalDate?: string; numberOfSlabs?: number; status?: string };
export default function IncomingTransferForm({ ticket, onClose, onSave, onMarkReceived }: {
    ticket: Loose; onClose: () => void; onSave?: (id: string, fields: Fields) => Promise<unknown>;
    /** PATCH /:id/receive; resolves to the updated ticket. */
    onMarkReceived?: (id: string) => Promise<Loose>;
}) {
    const [received, setReceived] = useState<{ at?: unknown; by?: string } | null>(ticket.receivedAt ? { at: ticket.receivedAt, by: ticket.receivedBy } : null);
    const [receiving, setReceiving] = useState(false);
    const markReceived = async () => {
        if (!onMarkReceived) return;
        setReceiving(true); setError('');
        try {
            const updated = await onMarkReceived(String(ticket.id));
            setReceived({ at: updated?.receivedAt || new Date().toISOString(), by: updated?.receivedBy });
            // Marking it received also completes it (statusForReceived): follow
            // the server, unless someone has already picked a status here.
            if (updated?.status) {
                if (status === baseStatus) setStatus(String(updated.status));
                setBaseStatus(String(updated.status));
            }
        } catch (err) { setError((err as Error).message); }
        finally { setReceiving(false); }
    };
    const initialDate = String(ticket.expectedArrivalDate || '').slice(0, 10);
    const initialSlabs = String(ticket.numberOfSlabs ?? 0);
    const [baseStatus, setBaseStatus] = useState(String(ticket.status || ''));
    const [date, setDate] = useState(initialDate), [slabs, setSlabs] = useState(initialSlabs), [status, setStatus] = useState(baseStatus);
    // Scheduled / Delayed / Completed / Cancelled (RECEIVING_STATUSES); Pending,
    // which only the sender can set, still shows, greyed, when it's the status.
    const statusLocked = receivingStatusRefusal({ ...ticket, status: baseStatus });
    const statusOptions = STATUS_OPTIONS
        .filter((o) => isReceivingStatus(o.value) || o.value === baseStatus)
        .map((o) => (isReceivingStatus(o.value) ? o : { ...o, disabled: true }));
    // What a picked status also does (receivedFieldsForStatus, server-side).
    const statusNote = statusLocked || (status === baseStatus ? ''
        : status === 'cancelled' ? `Only ${ticket.location || 'the sending branch'} can restore it once cancelled.`
        : status === 'completed' ? (received ? '' : 'Also marks it received.')
        : received ? 'Also un-marks it received.' : '');
    const [saving, setSaving] = useState(false), [submitted, setSubmitted] = useState(false), [error, setError] = useState('');
    const dirty = Number(date !== initialDate) + Number(slabs !== initialSlabs) + Number(status !== baseStatus);
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
        if (status !== baseStatus) fields.status = status;
        setSaving(true); setError('');
        try {
            if (!onSave) throw new Error('Incoming transfer updates are unavailable. Refresh and try again.');
            await onSave(String(ticket.id), fields); onClose();
        } catch (err) { setError((err as Error).message); }
        finally { setSaving(false); }
    };
    return <FormModal title="Update incoming transfer" size="s" onClose={onClose} onSubmit={save}
        submitLabel="Save changes" footerNote="Submitted Daily Reports must be reopened to reflect changes." saving={saving} dirtyCount={dirty} submitDisabled={!dirty}
        errors={errors} showErrors={submitted} fieldLabels={{ expectedArrivalDate: 'Expected delivery date', numberOfSlabs: 'Slab count', status: 'Status' }}>
        <p>{ticket.location} → {ticket.transferDestination} · {ticket.customerName}</p>
        <p>The sending branch controls the driver and ship date. You can update the expected delivery date, slab count and status.</p>
        {error && <div role="alert">{error}</div>}
        <div className="df-note it-received" aria-live="polite">
            {received
                ? <span>Received{received.at ? ` ${receivedDay(received.at)}` : ''}{received.by ? ` by ${received.by}` : ''}</span>
                : <>
                    <span>Not marked received yet.</span>
                    {onMarkReceived && baseStatus !== 'cancelled' && <button type="button" className="fm-btn fm-btn-small" onClick={markReceived} disabled={receiving}>
                        {receiving ? 'Marking…' : 'Mark received'}
                    </button>}
                </>}
        </div>
        <FormField name="expectedArrivalDate" id="incoming-eta" label="Expected delivery date" error={submitted ? errors.expectedArrivalDate : ''}>
            <DatePicker id="incoming-eta" value={date} onChange={setDate} clearable={false} sheetTitle="Expected delivery date" />
        </FormField>
        <FormField name="numberOfSlabs" id="incoming-slabs" label="Slab count" required error={submitted ? errors.numberOfSlabs : ''}>
            <input id="incoming-slabs" className="fm-input" inputMode="numeric" value={slabs} onChange={event => setSlabs(event.target.value)} />
        </FormField>
        <FormField name="status" id="incoming-status" label="Status" status={statusNote}>
            <FormPicker id="incoming-status" value={status} onChange={setStatus} options={statusOptions} sheetTitle="Status" disabled={Boolean(statusLocked)} />
        </FormField>
    </FormModal>;
}

/** "Nov 3" — the day it was marked received, in the viewer's own clock. */
function receivedDay(at: unknown) {
    const d = new Date(String(at));
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
