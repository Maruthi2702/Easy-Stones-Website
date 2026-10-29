import { useCallback, useState } from 'react';
import ScheduleActivityForm, { type ScheduleSave } from '../../../components/shared/schedule/ScheduleActivityForm';
import { todayISO } from '../../../components/shared/calendar/calendarDates';
import {
    DEFAULT_VISIT_MINUTES, defaultVisitDate, minutesOf, newScheduleId, timeText, type BookedRow
} from '../../../utils/visitSlots';
import { customerOf, nameOf } from '../helpers';
import type { Booking, MapPin, ScheduleRow, VisitSlotInput } from '../types';

/**
 * "Schedule a visit" — what Add to calendar (and Reschedule) opens on the Route
 * Planner's customer panel: the shared schedule form with the customer already
 * chosen. `visitsByDate` is the Schedule the screen already holds; `booking` is
 * the customer's existing entry when rescheduling, which is left out of
 * "already booked" and whose own time, length, type and notes the form opens
 * with.
 */
export type ScheduleVisitSheetProps = {
    customer: MapPin;
    booking?: Booking | null;
    visitsByDate: Map<string, ScheduleRow[]>;
    onClose: () => void;
    onSave: (slot: VisitSlotInput) => Promise<boolean>;
    saving?: boolean;
};

const rowOf = (v: ScheduleRow): BookedRow => ({
    id: String(v._id),
    customerId: String(customerOf(v)?._id || (typeof v.customerId === 'string' ? v.customerId : '') || ''),
    startTime: v.startTime,
    endTime: v.endTime,
    label: customerOf(v)?.company || customerOf(v)?.contactName || v.activityType || 'Visit'
});

const minutesBetween = (start?: string, end?: string) => {
    const a = minutesOf(start);
    const b = minutesOf(end);
    return a != null && b != null && b > a ? b - a : DEFAULT_VISIT_MINUTES;
};

const ScheduleVisitSheet = ({ customer, booking = null, visitsByDate, onClose, onSave, saving = false }: ScheduleVisitSheetProps) => {
    const today = todayISO();
    // One id for this sheet, so a repeated send books once.
    const [entryId] = useState(newScheduleId);

    const bookedOn = useCallback(
        (iso: string) => (visitsByDate?.get(iso) || []).filter(v => !booking || String(v._id) !== String(booking.id)).map(rowOf),
        [visitsByDate, booking]
    );

    const existingDate = booking?.startTime ? String(booking.startTime).slice(0, 10) : '';
    const existing = booking
        ? (visitsByDate?.get(existingDate) || []).find(v => String(v._id) === String(booking.id)) || null
        : null;
    const keepsExisting = Boolean(booking) && existingDate >= today;

    const save = (value: ScheduleSave) => onSave({
        customer, booking, id: entryId,
        date: value.date, startTime: value.startTime, endTime: value.endTime,
        activityType: value.activityType, notes: value.notes
    });

    return (
        <ScheduleActivityForm
            title={booking ? 'Reschedule visit' : 'Schedule a visit'}
            customer={{ label: customer?.company || customer?.contactName || nameOf(customer || {}), city: customer?.city ? String(customer.city) : '' }}
            initial={{
                customerId: String(customer?._id || ''),
                date: keepsExisting ? existingDate : defaultVisitDate(),
                start: keepsExisting && booking ? timeText(minutesOf(booking.startTime) as number) : null,
                minutes: existing ? minutesBetween(existing.startTime, existing.endTime) : DEFAULT_VISIT_MINUTES,
                activityType: existing?.activityType || 'Visit',
                notes: existing?.notes || ''
            }}
            bookedOn={bookedOn}
            showNotes
            minDate={today}
            isEdit={Boolean(booking)}
            saving={saving}
            onClose={onClose}
            onSave={save}
        />
    );
};

export default ScheduleVisitSheet;
