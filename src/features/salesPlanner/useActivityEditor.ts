import { useState, useEffect } from 'react';
import { refreshPlannerSchedule } from './plannerSchedule';
import type { PlannerItem } from './plannerSchedule';
import { saveActivity, deleteActivity } from './salesPlannerApi';
import type { ScheduleSave } from '../../components/shared/schedule/ScheduleActivityForm';
import { newScheduleId } from '../../utils/visitSlots';

/**
 * The add / edit form and the delete check: which one is open, and their
 * writes. The form (components/shared/schedule) holds its own fields and checks
 * its own unsaved changes; this saves what it hands back. A write that lands
 * refreshes the planner's own copy and tells the dashboard (`onScheduleChange`).
 */
export default function useActivityEditor(onScheduleChange?: () => void) {
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingItem, setEditingItem] = useState<PlannerItem | null>(null);
    const [addingForDay, setAddingForDay] = useState<Date | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<string | null>(null);
    // A new entry's own id, set each time Add opens: a repeated send books once.
    const [newEntryId, setNewEntryId] = useState(newScheduleId);

    const openAdd = (day: Date | null) => {
        setEditingItem(null);
        setAddingForDay(day ? new Date(day) : null);
        setSaveError(null);
        setNewEntryId(newScheduleId());
        setShowAddModal(true);
    };

    const openEdit = (item: PlannerItem) => {
        setEditingItem(item);
        setAddingForDay(null);
        setSaveError(null);
        setShowAddModal(true);
    };

    const closeModal = () => {
        setShowAddModal(false);
        setEditingItem(null);
        setAddingForDay(null);
        setSaveError(null);
    };

    // The schedule form closes itself on Escape (asking first when there are
    // unsaved changes); only the delete check is closed here.
    useEffect(() => {
        if (!showDeleteModal) return undefined;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowDeleteModal(false); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [showDeleteModal]);

    /** Save what the form hands back; true when it landed, false (with the server's reason shown) when not. */
    const handleSave = async (value: ScheduleSave): Promise<boolean> => {
        const { customerId, startTime, endTime, activityType, notes } = value;
        try {
            setSaving(true);
            setSaveError(null);
            const response = await saveActivity(editingItem ? editingItem._id : null, {
                customerId, startTime, endTime, activityType, notes,
                ...(editingItem ? {} : { _id: newEntryId })
            });

            if (response.ok) {
                // The server has already broadcast this write, but our own copy
                // should not wait on the round trip back to hear about it.
                refreshPlannerSchedule();
                if (onScheduleChange) onScheduleChange();
                closeModal();
                return true;
            }
            const errorData = await response.json().catch(() => ({}));
            console.error('[Planner] Save failed:', errorData);
            setSaveError(errorData.message || errorData.error || 'That did not save. Try again.');
            return false;
        } catch (error) {
            console.error('[Planner] Save error:', error);
            setSaveError(`Network error: ${(error as Error).message}`);
            return false;
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = (id: string) => {
        setItemToDelete(id);
        setShowDeleteModal(true);
    };

    const closeDelete = () => setShowDeleteModal(false);

    const confirmDelete = async () => {
        if (!itemToDelete) return;
        try {
            const response = await deleteActivity(itemToDelete);
            if (response.ok) {
                refreshPlannerSchedule();
                if (onScheduleChange) onScheduleChange();
                setShowDeleteModal(false);
                setItemToDelete(null);
            }
        } catch (error) {
            console.error('Error deleting schedule:', error);
        }
    };

    return {
        saving, saveError, showAddModal, editingItem, addingForDay,
        showDeleteModal, openAdd, openEdit, closeModal, handleSave,
        handleDelete, closeDelete, confirmDelete
    };
}

export type ActivityEditor = ReturnType<typeof useActivityEditor>;
