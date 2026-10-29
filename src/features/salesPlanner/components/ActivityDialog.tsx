import { useCallback, useState } from 'react';
import ScheduleActivityForm from '../../../components/shared/schedule/ScheduleActivityForm';
import type { CustomerOption } from '../../../utils/customerOptions';
import type { ActivityEditor } from '../useActivityEditor';
import { loadPlannerDay, type PlannerItem } from '../plannerSchedule';
import { bookedRowOf, dayFromKey, initialFor, customerName } from '../salesPlanner';

export type ActivityDialogProps = {
    editor: ActivityEditor;
    customerOptions: CustomerOption[];
    isDropdownLoading?: boolean;
    /** The visible range's entries on a day (a day outside it is fetched when picked). */
    itemsFor: (day: Date) => PlannerItem[];
};

/** Schedule activity / Edit activity: the shared schedule form with a customer picker, type and notes. */
export default function ActivityDialog({ editor, customerOptions, isDropdownLoading, itemsFor }: ActivityDialogProps) {
    const { editingItem, addingForDay, saveError, saving, closeModal, handleSave } = editor;
    // Days the person has moved to that the planner isn't showing: fetched when picked.
    const [fetched, setFetched] = useState<Map<string, PlannerItem[]>>(new Map());

    const onDateChange = useCallback((iso: string) => {
        loadPlannerDay(iso)
            .then(items => setFetched(prev => new Map(prev).set(iso, items)))
            .catch(() => { /* the visible range's copy is used */ });
    }, []);

    const bookedOn = useCallback(
        (iso: string) => (fetched.get(iso) ?? itemsFor(dayFromKey(iso)))
            .filter(i => i._id !== editingItem?._id && i.status !== 'Cancelled')
            .map(bookedRowOf),
        [fetched, itemsFor, editingItem]
    );

    return (
        <ScheduleActivityForm
            title={editingItem ? 'Edit activity' : 'Schedule activity'}
            customerOptions={customerOptions}
            customersLoading={isDropdownLoading}
            customerLabelFallback={editingItem ? customerName(editingItem) : ''}
            initial={initialFor(editingItem, addingForDay)}
            bookedOn={bookedOn}
            isEdit={Boolean(editingItem)}
            saving={saving}
            error={saveError || ''}
            onDateChange={onDateChange}
            onClose={closeModal}
            onSave={handleSave}
        />
    );
}
