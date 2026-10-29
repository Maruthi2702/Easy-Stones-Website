import { useEffect, useMemo, useState } from 'react';
import { Ellipsis, Info, MapPin, Package, Phone, Trash2, TriangleAlert } from 'lucide-react';
import FormModal from '../form/FormModal';
import { FormField, FormPicker, FormSearchPicker, SegmentedToggle } from '../form/FormControls';
import { DatePicker } from '../calendar/Calendar';
import { formatDateText, todayISO } from '../calendar/calendarDates';
import type { CustomerOption } from '../../../utils/customerOptions';
import {
    DEFAULT_VISIT_MINUTES, LENGTH_MINUTES, addDaysISO, bookedForCustomer, bookedSpan, clockLabel, earliestStart,
    firstFreeSlot, minutesOf, nextDayWithRoom, overlapsOf, rangeLabel, startEnd, startIsPast, timeOptions, timeText,
    type BookedRow
} from '../../../utils/visitSlots';
import { ACTIVITY_TYPES } from '../../../utils/scheduleRecord';
import './ScheduleActivityForm.css';

/**
 * The one form that puts something on a rep's calendar: the Sales Planner's
 * add / edit activity, the Route Planner's "Add to calendar" / reschedule, and
 * the Route Planner Schedule panel's add / edit. What each screen passes in
 * differs (a fixed customer or a picker, notes or not); how the day, the start
 * time, the length and the warnings behave does not. The rules are
 * `src/utils/visitSlots.ts` (tested); the saved fields are checked again by the
 * server (`src/utils/scheduleRecord.js`).
 *
 * Data goes down as props, the save comes back through `onSave` — the form
 * never calls the network itself.
 */

export type ScheduleSave = {
    customerId: string;
    activityType: string;
    notes: string;
    date: string;
    /** 'YYYY-MM-DDTHH:mm:00.000', the stored local shape. */
    startTime: string;
    endTime: string;
};

export type ScheduleInitial = {
    customerId?: string;
    activityType?: string;
    notes?: string;
    /** 'YYYY-MM-DD' */
    date: string;
    /** 'HH:MM'; leave out to suggest the first free slot. */
    start?: string | null;
    minutes?: number;
};

export type ScheduleActivityFormProps = {
    title: string;
    /** A customer already chosen — shown as a line instead of a picker. */
    customer?: { label: string; city?: string } | null;
    customerOptions?: CustomerOption[];
    customersLoading?: boolean;
    /** Shown in the picker while the options are still loading (an edit opened first). */
    customerLabelFallback?: string;
    initial: ScheduleInitial;
    /** What's already on a day, as rows (the entry being edited left out by the caller). */
    bookedOn: (date: string) => BookedRow[];
    showNotes?: boolean;
    /** The earliest day the calendar offers; leave out to allow any (editing a past entry). */
    minDate?: string;
    isEdit?: boolean;
    saving?: boolean;
    /** A save the server refused, in its words. */
    error?: string;
    /** Called with the day on open and whenever it changes, so the caller can load that day's entries. */
    onDateChange?: (date: string) => void;
    onClose: () => void;
    onSave: (value: ScheduleSave) => Promise<boolean | void> | boolean | void;
    onDelete?: (() => void) | null;
};

const TIMES = timeOptions();

const TYPE_ICONS: Record<string, typeof MapPin> = { Visit: MapPin, Call: Phone, 'Drop-off': Package, Other: Ellipsis };
const TYPE_OPTIONS = ACTIVITY_TYPES.map((value) => {
    const Icon = TYPE_ICONS[value] || Ellipsis;
    return { value, label: <><Icon size={16} aria-hidden="true" /><span>{value}</span></> };
});

const lengthLabel = (m: number) => (m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60} hr` : `${Math.floor(m / 60)}½ hr`);
const lengthShort = (m: number) => (m < 60 ? `${m}m` : m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}½h`);
const lengthOption = (m: number) => ({
    value: String(m),
    label: <><span className="sa-long">{lengthLabel(m)}</span><span className="sa-short">{lengthShort(m)}</span></>
});

const dayLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

export default function ScheduleActivityForm({
    title, customer = null, customerOptions = [], customersLoading = false, customerLabelFallback = '',
    initial, bookedOn, showNotes = true, minDate = '', isEdit = false, saving = false, error = '',
    onDateChange, onClose, onSave, onDelete = null
}: ScheduleActivityFormProps) {
    const today = todayISO();
    const tomorrow = addDaysISO(today, 1);

    const [customerId, setCustomerId] = useState(initial.customerId || '');
    const [activityType, setActivityType] = useState(initial.activityType || 'Visit');
    const [notes, setNotes] = useState(initial.notes || '');
    const [date, setDate] = useState(initial.date);
    const [minutes, setMinutes] = useState(String(initial.minutes || DEFAULT_VISIT_MINUTES));
    // Until the person picks a time themselves, the start follows the day and
    // the length: the first free slot that fits. An entry being edited keeps its own.
    const [pickedTime, setPickedTime] = useState(initial.start || '');
    const [tried, setTried] = useState(false);
    useEffect(() => { onDateChange?.(date); }, [date, onDateChange]);

    const length = Number(minutes);
    const booked = useMemo(() => bookedOn(date), [bookedOn, date]);
    const from = earliestStart(date);
    const freeStart = firstFreeSlot(booked, { minutes: length, from });
    const time = pickedTime || freeStart || timeText(from);
    const start = minutesOf(time) as number;

    // Editing only a stop's notes shouldn't warn about a time nobody touched
    // (an existing 9:00 that overlaps another, or one already gone by today).
    const timeTouched = !isEdit || time !== initial.start || date !== initial.date || minutes !== String(initial.minutes || DEFAULT_VISIT_MINUTES);
    const overlaps = timeTouched ? overlapsOf(booked, start, length) : [];
    const sameCustomer = timeTouched || customerId !== (initial.customerId || '') ? bookedForCustomer(booked, customerId) : [];
    const past = timeTouched && startIsPast(date, start);
    const dayFull = timeTouched && freeStart === null;
    const nextRoom = dayFull ? nextDayWithRoom(addDaysISO(date, 1), bookedOn, length) : null;
    // Where "Use … instead" points: the first free start, when that isn't what's picked.
    const alternative = freeStart && freeStart !== time ? freeStart : null;

    const customerName = (customer?.label || customerOptions.find((o) => o.value === customerId)?.label || '').trim();
    const lengths = LENGTH_MINUTES.includes(length) ? LENGTH_MINUTES : [...LENGTH_MINUTES, length].sort((a, b) => a - b);

    const dirtyCount =
        Number(customerId !== (initial.customerId || '')) +
        Number(activityType !== (initial.activityType || 'Visit')) +
        Number(notes !== (initial.notes || '')) +
        Number(date !== initial.date) +
        Number(minutes !== String(initial.minutes || DEFAULT_VISIT_MINUTES)) +
        Number(Boolean(pickedTime) && pickedTime !== (initial.start || ''));

    const errors = { customer: !customer && !customerId ? 'Pick a customer' : '' };

    const submit = async () => {
        setTried(true);
        if (errors.customer) return;
        const ok = await onSave({ customerId, activityType, notes, date, ...startEnd(date, time, length) });
        if (ok !== false) onClose();
    };

    const dateText = (iso: string) => `${formatDateText(iso)}${iso === today ? ' · Today' : iso === tomorrow ? ' · Tomorrow' : ''}`;

    // The day's list, with this visit in its place so you can see where it lands.
    const rows = [
        ...booked.map((b) => ({ key: `b-${b.id || b.startTime}`, span: bookedSpan(b), label: b.label || 'Booked', mine: false })),
        { key: 'new', span: { start, end: start + length, assumed: false }, label: 'This visit', mine: true }
    ]
        .filter((r): r is typeof r & { span: NonNullable<typeof r.span> } => r.span !== null)
        .sort((a, b) => a.span.start - b.span.start);

    const verb = isEdit ? 'Save' : 'Schedule';
    const submitLabel = `${verb} ${dayLabel(date)} · ${clockLabel(start)}`;

    return (
        <FormModal
            title={title}
            size="s"
            onClose={onClose}
            onSubmit={submit}
            submitLabel={submitLabel}
            saving={saving}
            dirtyCount={dirtyCount}
            errors={errors}
            showErrors={tried}
            fieldLabels={{ customer: 'Customer' }}
            footerStart={onDelete ? (
                <button type="button" className="sa-remove" onClick={onDelete} disabled={saving}>
                    <Trash2 size={15} aria-hidden="true" /> Remove
                </button>
            ) : null}
        >
            {customer ? (
                <p className="sa-who">
                    <MapPin size={16} aria-hidden="true" />
                    <span>{customer.label}</span>
                    {customer.city && <span className="sa-who-city">· {customer.city}</span>}
                </p>
            ) : (
                <FormField name="customer" id="sa-customer" label="Customer" required error={tried ? errors.customer : ''}>
                    <FormSearchPicker
                        id="sa-customer"
                        value={customerId}
                        onChange={setCustomerId}
                        options={customerOptions}
                        placeholder="Search customers…"
                        sheetTitle="Customer"
                        loading={customersLoading}
                        selectedLabel={customerLabelFallback}
                        error={tried ? errors.customer : ''}
                    />
                </FormField>
            )}

            <FormField name="type" id="sa-type" label="Type">
                <div className="sa-type">
                    <SegmentedToggle label="Type" value={activityType} onChange={setActivityType} options={TYPE_OPTIONS} />
                </div>
            </FormField>

            <FormField name="date" id="sa-date" label="Day" required>
                <DatePicker
                    id="sa-date"
                    value={date}
                    onChange={(v) => { if (v) { setDate(v); setPickedTime(''); } }}
                    min={minDate}
                    formatText={dateText}
                    sheetTitle="Day"
                />
            </FormField>

            <FormField name="time" id="sa-time" label="Start time" status={`Ends ${clockLabel(start + length)}`}>
                <FormPicker id="sa-time" value={time} onChange={setPickedTime} options={TIMES} sheetTitle="Start time" />
            </FormField>

            <FormField name="length" id="sa-length" label="Length">
                <div className="sa-length">
                    <SegmentedToggle
                        label="Length"
                        value={minutes}
                        onChange={(v) => { setMinutes(v); setPickedTime(''); }}
                        options={lengths.map(lengthOption)}
                    />
                </div>
            </FormField>

            <div className="sa-notices" aria-live="polite">
                {overlaps.length > 0 && (
                    <p className="sa-note" data-tone="warn">
                        <TriangleAlert size={17} aria-hidden="true" />
                        <span>
                            <b>Overlaps {overlaps.map((b) => b.label || 'a booking').join(', ')}</b>.
                            {alternative && <> <button type="button" className="sa-note-action" onClick={() => setPickedTime(alternative)}>Use {clockLabel(minutesOf(alternative) as number)} instead</button></>}
                        </span>
                    </p>
                )}
                {past && (
                    <p className="sa-note" data-tone="warn">
                        <TriangleAlert size={17} aria-hidden="true" />
                        <span>
                            <b>That time has already passed today.</b>
                            {alternative && <> <button type="button" className="sa-note-action" onClick={() => setPickedTime(alternative)}>Use {clockLabel(minutesOf(alternative) as number)} instead</button></>}
                        </span>
                    </p>
                )}
                {sameCustomer.length > 0 && (
                    <p className="sa-note" data-tone="warn">
                        <TriangleAlert size={17} aria-hidden="true" />
                        <span>
                            <b>{customerName || 'This customer'} is already booked {dayLabel(date)}</b>
                            {' '}at {sameCustomer.map((b) => clockLabel(minutesOf(b.startTime) as number)).join(', ')}.
                        </span>
                    </p>
                )}
                {dayFull && (
                    <p className="sa-note" data-tone="info">
                        <Info size={17} aria-hidden="true" />
                        <span>
                            <b>No {lengthLabel(length)} gap on {dayLabel(date)}.</b>
                            {nextRoom
                                ? <> <button type="button" className="sa-note-action" onClick={() => { setDate(nextRoom); setPickedTime(''); }}>Try {dayLabel(nextRoom)}</button> or pick a start time yourself.</>
                                : <> Pick a start time yourself.</>}
                        </span>
                    </p>
                )}
            </div>

            <div className="sa-day">
                <div className="sa-day-head">
                    <span className="sa-day-title">{booked.length ? `Already on ${dayLabel(date)}` : `${dayLabel(date)}`}</span>
                    <span className="sa-day-count">{booked.length === 0 ? 'Nothing booked yet' : `${booked.length} ${booked.length === 1 ? 'visit' : 'visits'}`}</span>
                </div>
                {rows.map((r) => (
                    <div key={r.key} className="sa-day-row" data-mine={r.mine ? 'true' : undefined}>
                        <span className="sa-day-time">{r.span.assumed ? `${clockLabel(r.span.start)} · about ${DEFAULT_VISIT_MINUTES} min` : rangeLabel(r.span.start, r.span.end)}</span>
                        <span className="sa-day-what">{r.label}</span>
                    </div>
                ))}
            </div>

            {showNotes && (
                <FormField name="notes" id="sa-notes" label="Notes">
                    <textarea
                        id="sa-notes"
                        className="fm-input fm-textarea"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Agenda or special instructions"
                        rows={3}
                        maxLength={2000}
                        autoCapitalize="sentences"
                    />
                </FormField>
            )}

            {error && (
                <p className="sa-note" data-tone="error" role="alert">
                    <TriangleAlert size={17} aria-hidden="true" />
                    <span>{error}</span>
                </p>
            )}
        </FormModal>
    );
}
