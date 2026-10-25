import { useState, useEffect } from 'react';
import { refreshPlannerSchedule } from './plannerSchedule';
import type { PlannerItem } from './plannerSchedule';
import { saveActivity, deleteActivity } from './salesPlannerApi';
import { EMPTY_FORM, defaultStartFor, formFor, type ActivityForm } from './salesPlanner';

/**
 * The add / edit form and the delete check: what each holds, opening and
 * closing them (Escape included), and their writes. A write that lands
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
    const [form, setForm] = useState<ActivityForm>(EMPTY_FORM);

    const openAdd = (day: Date | null) => {
        setEditingItem(null);
        setAddingForDay(day ? new Date(day) : new Date());
        setSaveError(null);
        setForm({ ...EMPTY_FORM, startTime: defaultStartFor(day) });
        setShowAddModal(true);
    };

    const openEdit = (item: PlannerItem) => {
        setEditingItem(item);
        setAddingForDay(null);
        setSaveError(null);
        setForm(formFor(item));
        setShowAddModal(true);
    };

    const closeModal = () => {
        setShowAddModal(false);
        setEditingItem(null);
        setAddingForDay(null);
        setSaveError(null);
    };

    useEffect(() => {
        if (!showAddModal && !showDeleteModal) return undefined;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (showDeleteModal) setShowDeleteModal(false);
            else closeModal();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [showAddModal, showDeleteModal]);

    const handleSave = async (e?: React.SyntheticEvent) => {
        if (e) e.preventDefault();

        if (!form.customerId || !form.startTime) {
            setSaveError('Pick a customer and a start time.');
            return;
        }

        try {
            setSaving(true);
            setSaveError(null);
            const response = await saveActivity(editingItem ? editingItem._id : null, form);

            if (response.ok) {
                // The server has already broadcast this write, but our own copy
                // should not wait on the round trip back to hear about it.
                refreshPlannerSchedule();
                if (onScheduleChange) onScheduleChange();
                closeModal();
                setForm(EMPTY_FORM);
            } else {
                const errorData = await response.json().catch(() => ({}));
                console.error('[Planner] Save failed:', errorData);
                setSaveError(errorData.message || errorData.error || 'That did not save. Try again.');
            }
        } catch (error) {
            console.error('[Planner] Save error:', error);
            setSaveError(`Network error: ${(error as Error).message}`);
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
        form, setForm, saving, saveError, showAddModal, editingItem, addingForDay,
        showDeleteModal, openAdd, openEdit, closeModal, handleSave,
        handleDelete, closeDelete, confirmDelete
    };
}

export type ActivityEditor = ReturnType<typeof useActivityEditor>;
