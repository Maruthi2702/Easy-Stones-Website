import { useMemo, useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection, FormRow, FormField, FormPicker } from '../../../components/shared/form/FormControls';
import { describedBy } from '../../../components/shared/form/formFocus';
import LocationPicker from '../../../components/shared/form/LocationPicker';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import { todayISO } from '../../../components/shared/calendar/calendarDates';
import { isThirdPartyTruck } from '../../../utils/deliveryPickup';
import { locationNames } from '../../../utils/locationFilter';
import {
    ARRIVAL_FIELD_LABELS, arrivalBranchesFor, arrivalErrors, arrivalPayload, countArrivalChanges, emptyArrival
} from '../../../utils/transferArrival';
import type { ArrivalField, ArrivalPayload, ArrivalValues } from '../../../utils/transferArrival';
import type { CurrentUser } from '../../../types/records';
import type { BoardColumn } from '../types';
import './DeliveryForm.css';

const newArrivalId = () => `del_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/**
 * Log arrival: a transfer that arrived although the sending branch never put
 * it on the schedule. Saved as the sender's transfer, received, and added to
 * both branches' Daily Reports (src/utils/transferArrival.ts; the server is
 * POST /api/deliveries/arrivals). Shared form template, size M.
 */
export default function LogArrivalForm({ currentUser, trucks, locationsList: locationsGiven, onClose, onSave }: {
    currentUser: CurrentUser | null;
    trucks: BoardColumn[];
    /** Location names or Location records, as the page holds them. */
    locationsList: unknown[];
    onClose: () => void;
    /** Saves the arrival; throws with the server's reason to show. */
    onSave: (payload: ArrivalPayload) => Promise<unknown>;
}) {
    const today = todayISO();
    const locationsList = useMemo(() => locationNames(locationsGiven), [locationsGiven]);
    const receivingBranches = useMemo(() => arrivalBranchesFor(currentUser?.assignedLocations, locationsList), [currentUser, locationsList]);
    // The drivers this board shows, contract freight first: almost every
    // transfer comes on it (KNOWN_ISSUES transfers #4).
    const driverChoices = useMemo(() => trucks
        .filter((t) => !t.inactive)
        .sort((a, b) => Number(isThirdPartyTruck(b)) - Number(isThirdPartyTruck(a)))
        .map((t) => ({ value: t.id, label: isThirdPartyTruck(t) ? '3rd party · contract freight' : (t.driver || t.name || t.id) })), [trucks]);
    const [start] = useState(() => emptyArrival({ today, receivingBranches, truckId: driverChoices[0]?.value || '' }));
    const [values, setValues] = useState<ArrivalValues>(start);
    const [id] = useState(newArrivalId);
    const [submitted, setSubmitted] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');

    const set = (patch: Partial<ArrivalValues>) => setValues((v) => ({ ...v, ...patch }));
    const errors = arrivalErrors(values, { receivingBranches, branches: locationsList, today });
    const shown = (field: ArrivalField) => (submitted ? errors[field] || '' : '');
    const dirty = countArrivalChanges(values, start);

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        setSubmitted(true);
        if (Object.keys(errors).length) return;
        setSaving(true); setSaveError('');
        try {
            await onSave(arrivalPayload(values, id));
            onClose();
        } catch (err) {
            setSaveError((err as Error).message);
        } finally {
            setSaving(false);
        }
    };

    const from = values.from || 'the sending branch';
    return (
        <FormModal
            title="Log arrival"
            size="m"
            onClose={onClose}
            onSubmit={save}
            submitLabel="Log arrival"
            savingLabel="Logging…"
            saving={saving}
            dirtyCount={dirty}
            errors={errors}
            showErrors={submitted}
            fieldLabels={ARRIVAL_FIELD_LABELS}
            footerNote={`${from} is emailed, and it’s added to both Daily Reports — even submitted ones.`}
        >
            <div className="df-note df-note-warn">
                <span>
                    For a transfer that arrived but isn’t on the schedule. It’s saved as {from}’s transfer, received,
                    and shipped the day it arrived until {from} changes it.
                </span>
            </div>
            {saveError && <div className="df-note df-note-err" role="alert">{saveError}</div>}

            <FormSection>
                <FormRow>
                    <FormField name="from" id="la-from" label="From" required error={shown('from')}>
                        <LocationPicker
                            id="la-from"
                            value={values.from}
                            onChange={(v) => set({ from: v })}
                            options={locationsList.filter((l) => l !== values.to)}
                            user={currentUser}
                            placeholder="Pick a branch"
                            sheetTitle="From"
                            error={shown('from')}
                        />
                    </FormField>
                    <FormField name="to" id="la-to" label="Arrived at" required error={shown('to')}>
                        <LocationPicker
                            id="la-to"
                            value={values.to}
                            onChange={(v) => set({ to: v })}
                            options={receivingBranches}
                            user={currentUser}
                            placeholder="Pick a branch"
                            sheetTitle="Arrived at"
                            error={shown('to')}
                        />
                    </FormField>
                </FormRow>
                <FormRow>
                    <FormField name="arrivedOn" id="la-arrivedOn" label="Arrived on" required error={shown('arrivedOn')}>
                        <DatePicker
                            id="la-arrivedOn"
                            value={values.arrivedOn}
                            onChange={(v: string) => set({ arrivedOn: v })}
                            max={today}
                            error={shown('arrivedOn')}
                            clearable={false}
                            sheetTitle="Arrived on"
                        />
                    </FormField>
                    <FormField name="transferNumber" id="la-transferNumber" label="Transfer #" error={shown('transferNumber')}>
                        <input
                            id="la-transferNumber"
                            className="fm-input no-capitalize"
                            type="text"
                            value={values.transferNumber}
                            placeholder="From the paperwork"
                            autoComplete="off"
                            onChange={(e) => set({ transferNumber: e.target.value })}
                            {...describedBy('la-transferNumber', shown('transferNumber'), null)}
                        />
                    </FormField>
                </FormRow>
                <FormRow>
                    <FormField name="numberOfSlabs" id="la-numberOfSlabs" label="Slabs received" required error={shown('numberOfSlabs')}>
                        <input
                            id="la-numberOfSlabs"
                            className="fm-input"
                            inputMode="numeric"
                            value={values.numberOfSlabs}
                            autoComplete="off"
                            onChange={(e) => set({ numberOfSlabs: e.target.value })}
                            {...describedBy('la-numberOfSlabs', shown('numberOfSlabs'), null)}
                        />
                    </FormField>
                    <FormField name="truckId" id="la-truckId" label="Driver" required error={shown('truckId')}>
                        <FormPicker
                            id="la-truckId"
                            value={values.truckId}
                            onChange={(v: string) => set({ truckId: v })}
                            options={driverChoices}
                            placeholder="Who brought it"
                            sheetTitle="Driver"
                            error={shown('truckId')}
                        />
                    </FormField>
                </FormRow>
                <FormField name="notes" id="la-notes" label="Notes" error={shown('notes')}>
                    <textarea
                        id="la-notes"
                        className="fm-input"
                        rows={3}
                        value={values.notes}
                        autoCapitalize="sentences"
                        onChange={(e) => set({ notes: e.target.value })}
                    />
                </FormField>
            </FormSection>
        </FormModal>
    );
}
