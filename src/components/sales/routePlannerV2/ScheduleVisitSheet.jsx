import React, { useMemo, useState } from 'react';
import FormModal from '../../shared/form/FormModal';
import { FormField, FormPicker } from '../../shared/form/FormControls';
import { DatePicker } from '../../shared/calendar/Calendar';
import { todayISO } from '../../shared/calendar/calendarDates';
import {
    quickDates, firstFreeSlot, timeOptions, clockLabel, minutesOf, startEnd, DAY_START, timeText
} from '../../../utils/visitSlots';
import './ScheduleVisitSheet.css';

const LENGTHS = [15, 30, 45, 60, 90, 120].map(m => ({ value: String(m), label: m < 60 ? `${m} min` : m === 60 ? '1 hour' : `${m / 60} hours` }));
const TIMES = timeOptions();

const dayLabel = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * "Schedule a visit" — what Add to calendar (and Reschedule) opens on the Route
 * Planner's customer panel, so a visit can go on any day, not only the one set
 * in the Tools panel. Pick a day (Tomorrow / Next week / In 2 weeks, or the
 * calendar), and it suggests the first free start that day and shows what's
 * already booked there so a visit isn't put on top of another.
 *
 * A form like the rest (FormModal: a sheet on phones, a window on desktop; the
 * shared DatePicker, never a hand-built one). `visitsByDate` is the Schedule the
 * screen already holds; `booking` is the customer's existing entry when
 * rescheduling, which is left out of "already booked".
 */
const ScheduleVisitSheet = ({
    customer, booking = null, visitsByDate, minutes: startMinutes = 45,
    onClose, onSave, saving = false
}) => {
    const today = todayISO();
    const shortcuts = useMemo(() => quickDates(today), [today]);
    const existingDate = booking?.startTime ? String(booking.startTime).slice(0, 10) : '';

    const bookedOn = (iso) => (visitsByDate?.get(iso) || []).filter(v => !booking || String(v._id) !== String(booking.id));

    const [date, setDate] = useState(existingDate >= today ? existingDate : shortcuts[1].value);
    const [minutes, setMinutes] = useState(String(startMinutes));
    // Until the person picks a time themselves, the start follows the date and
    // the length: the first free slot that fits.
    const [pickedTime, setPickedTime] = useState('');
    const suggested = useMemo(
        () => firstFreeSlot(bookedOn(date), { minutes: Number(minutes) }) || timeText(DAY_START),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [date, minutes, visitsByDate, booking]
    );
    const time = pickedTime || suggested;

    const booked = bookedOn(date);
    const full = firstFreeSlot(booked, { minutes: Number(minutes) }) === null;
    const submitLabel = `${booking ? 'Move to' : 'Schedule'} ${dayLabel(date)} · ${clockLabel(minutesOf(time))}`;

    const submit = async () => {
        const ok = await onSave({ customer, booking, date, ...startEnd(date, time, Number(minutes)) });
        if (ok !== false) onClose();
    };

    return (
        <FormModal
            title={booking ? 'Reschedule visit' : 'Schedule a visit'}
            size="s"
            onClose={onClose}
            onSubmit={submit}
            submitLabel={submitLabel}
            saving={saving}
            submitDisabled={!date}
        >
            <p className="rpv2-sched-who">{customer?.company || customer?.contactName || 'Customer'}</p>

            <FormField name="date" id="rpv2-sched-date" label="Day" required>
                <DatePicker id="rpv2-sched-date" value={date} onChange={(v) => { setDate(v); setPickedTime(''); }} min={today} shortcuts={shortcuts} />
            </FormField>

            <div className="rpv2-sched-row">
                <FormField name="time" id="rpv2-sched-time" label="Start time">
                    <FormPicker id="rpv2-sched-time" value={time} onChange={setPickedTime} options={TIMES} sheetTitle="Start time" />
                </FormField>
                <FormField name="length" id="rpv2-sched-length" label="Length">
                    <FormPicker id="rpv2-sched-length" value={minutes} onChange={(v) => { setMinutes(v); setPickedTime(''); }} options={LENGTHS} sheetTitle="Length" />
                </FormField>
            </div>

            <div className="rpv2-sched-day" aria-live="polite">
                <span className="rpv2-sched-day-title">Already on {dayLabel(date)}</span>
                {booked.length === 0 && <span className="rpv2-sched-none">Nothing booked yet.</span>}
                {booked.map(v => (
                    <div key={v._id} className="rpv2-sched-visit">
                        <span className="rpv2-sched-time">{clockLabel(minutesOf(v.startTime))}</span>
                        <span>{v.customerId?.company || v.customerId?.contactName || v.activityType || 'Visit'}</span>
                    </div>
                ))}
                {full && booked.length > 0 && <span className="rpv2-sched-none">No free slot this long that day — pick another start time or day.</span>}
            </div>
        </FormModal>
    );
};

export default ScheduleVisitSheet;
