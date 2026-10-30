import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { formatForDateInput } from '../../utils/dateUtils';
import { newVisitId } from '../../utils/visitForm';
import { compressImage, fileToBase64 } from '../../utils/attachmentFiles';
import type { Loose } from '../../types/records';
import type { DeleteRequest } from '../teamFiles/useTeamFiles';

/** What the page gives the visit editor (MIGRATION_NOTES.md §4, step A3). */
export type VisitEditorDeps = {
    currentUser: Loose | null;
    selectedCustomerId: string | null;
    selectedCustomer: Loose | null;
    /** The Customers tab's first page — a visit's customer name and branch. */
    customers: Loose[];
    customerOptions: { value: string; label: string }[];
    /** Show a saved visit on the open customer at once / take it back off. */
    patchOpenCustomerVisits: (customerId: string, visit: Loose) => void;
    removeOpenCustomerVisit: (customerId: string, visitId: string) => void;
    /** Same for the dashboard's list; `isNew` puts it at the top. */
    patchDashboardVisit: (visit: Loose, isNew?: boolean) => void;
    removeDashboardVisit: (visitId: string) => void;
    setCurrentFollowUpPage: (page: number) => void;
    showSaveToast: (text: string, kind?: string) => void;
    /** Reload what a saved visit changes (customer, dashboard, schedules). */
    refreshAfterSave: (customerId: string, options?: { dashboard?: boolean; schedules?: boolean }) => void;
    setDeleteConfirmation: (request: DeleteRequest) => void;
};

/**
 * The Add / Edit / View visit form's state and everything it does: opening it
 * (new, from a customer's pin, from a row), the early photo uploads, the save
 * that closes the form at once and sends behind it, and the delete check.
 * Moved out of SalesPage unchanged (2026-10-23).
 */
export function useVisitEditor({ currentUser, selectedCustomerId, selectedCustomer, customers, customerOptions, patchOpenCustomerVisits, removeOpenCustomerVisit, patchDashboardVisit, removeDashboardVisit, setCurrentFollowUpPage, showSaveToast, refreshAfterSave, setDeleteConfirmation }: VisitEditorDeps) {
    const [showVisitModal, setShowVisitModal] = useState(false);

    const [editingVisit, setEditingVisit] = useState<Loose | null>(null);

    const [isViewingVisit, setIsViewingVisit] = useState(false);

    const [visitForm, setVisitForm] = useState<Loose>({
        date: '',
        purpose: 'Scheduled in Person Sales Meeting',
        notes: '',
        outcome: '',
        followUp: '',
        followUpDate: '',
        nextAction: '',
        image: [] // Array of strings
    });

    const [visitUploading, setVisitUploading] = useState(false);
    const visitUploadsRef = useRef(new Set<Promise<void>>());   // uploads still going
    const visitUploadedRef = useRef(new Map<string, string>());  // picked photo data → stored link
    const visitSavesInFlight = useRef(0);        // saves sent and not yet answered
    const visitModalOpenRef = useRef(false);

    const [loadingVisitId, setLoadingVisitId] = useState<string | null>(null);

    const handleEditVisit = async (visit: Loose) => {
        if (!visit?.customerId || !visit?._id) {
            setEditingVisit(visit);
            setIsViewingVisit(false);
            setVisitForm({
                date: visit.date ? formatForDateInput(visit.date) : '',
                purpose: visit.purpose || '',
                notes: visit.notes || '',
                outcome: visit.outcome || '',
                followUp: visit.followUp || visit.nextAction || '',
                followUpDate: visit.followUpDate ? formatForDateInput(visit.followUpDate) : '',
                managerComment: visit.managerComment || '',
                headquartersComment: visit.headquartersComment || '',
                image: Array.isArray(visit.image) ? visit.image : (visit.image ? [visit.image] : []),
                customerId: visit.customerId || selectedCustomerId || ''
            });
            setShowVisitModal(true);
            return;
        }

        setLoadingVisitId(visit._id);
        try {
            const response = await authFetch(`${API_URL}/api/customers/${visit.customerId}/visits/${visit._id}`);
            const data = await response.json();

            if (data && data.visit) {
                const formattedVisit = {
                    ...data.visit,
                    customerId: visit.customerId, // Preserve customerId
                    date: formatForDateInput(data.visit.date),
                    followUpDate: data.visit.followUpDate ? formatForDateInput(data.visit.followUpDate) : ''
                };
                setVisitForm(formattedVisit);
                // The dashboard's row knows the customer's branch; the form's
                // Delete needs it for branch-level delete permission.
                setEditingVisit({ ...formattedVisit, location: visit.location });
            } else {
                const formattedVisit = {
                    ...visit,
                    date: formatForDateInput(visit.date),
                    followUpDate: visit.followUpDate ? formatForDateInput(visit.followUpDate) : ''
                };
                setVisitForm(formattedVisit);
                setEditingVisit(formattedVisit);
            }
            setIsViewingVisit(false);
            setShowVisitModal(true);
        } catch (error) {
            console.error('Error fetching visit details for edit:', error);
            setVisitForm(visit);
            setEditingVisit(visit);
            setIsViewingVisit(false);
            setShowVisitModal(true);
        } finally {
            setLoadingVisitId(null);
        }
    };

    const handleViewVisit = async (visit: Loose) => {
        if (!visit?.customerId || !visit?._id) {
            setVisitForm(visit || {});
            setEditingVisit(visit);
            setShowVisitModal(true);
            setIsViewingVisit(true);
            return;
        }

        setLoadingVisitId(visit._id);
        try {
            const response = await authFetch(`${API_URL}/api/customers/${visit.customerId}/visits/${visit._id}`);
            const data = await response.json();


            if (data && data.visit) {
                const formattedVisit = {
                    ...data.visit,
                    customerId: visit.customerId, // Preserve customerId
                    date: formatForDateInput(data.visit.date),
                    followUpDate: data.visit.followUpDate ? formatForDateInput(data.visit.followUpDate) : ''
                };
                setVisitForm(formattedVisit);
                setEditingVisit(formattedVisit);
            } else {
                const formattedVisit = {
                    ...visit,
                    date: formatForDateInput(visit.date),
                    followUpDate: visit.followUpDate ? formatForDateInput(visit.followUpDate) : ''
                };
                setVisitForm(formattedVisit);
                setEditingVisit(formattedVisit);
            }
            setShowVisitModal(true);
            setIsViewingVisit(true);
        } catch (error) {
            console.error('Error fetching visit details:', error);
            setVisitForm(visit);
            setEditingVisit(visit);
            setShowVisitModal(true);
            setIsViewingVisit(true);
        } finally {
            setLoadingVisitId(null);
        }
    };

    useEffect(() => { visitModalOpenRef.current = showVisitModal; }, [showVisitModal]);

    // A visit that is still being sent is lost if the tab closes now.
    useEffect(() => {
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            if (visitSavesInFlight.current > 0) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, []);

    const handleCloseVisitModal = () => {
        setVisitForm({
            date: '',
            purpose: 'Scheduled in Person Sales Meeting',
            notes: '',
            outcome: '',
            followUp: '',
            followUpDate: '',
            image: []
        });
        setEditingVisit(null);
        setIsViewingVisit(false);
        setShowVisitModal(false);
    };

    // VisitForm passes what to save (hidden follow-up fields already cleared —
    // visitValuesToSave); anything else, such as a click event, means the form state.
    //
    // The form closes and the visit shows on the customer at once; the request
    // goes behind it. A new visit carries its own id, so the retry below (or a
    // lost answer) can't add it twice — the server answers a repeat with the
    // visit it already has. If the save fails, the visit is taken back off the
    // screen and the form reopens with everything that was typed.
    const handleSaveVisit = async (values?: unknown) => {
        const form: Loose = values && typeof values === 'object' && !(values as Loose).nativeEvent ? (values as Loose) : visitForm;
        const targetCustomerId = form.customerId || selectedCustomerId;
        if (!targetCustomerId || !form.date || !form.purpose) {
            alert('Please fill in all mandatory fields (Customer, Date, Visit Type)');
            return;
        }

        const editing = editingVisit;
        const visitId = editing ? editing._id : newVisitId();
        const url = editing
            ? `${API_URL}/api/customers/${targetCustomerId}/visits/${editing._id}`
            : `${API_URL}/api/customers/${targetCustomerId}/visits`;
        const payload: Loose = {
            ...form,
            date: form.date, // Send as-is, backend will handle with ensureDateString
            followUpDate: form.followUpDate || ''
        };
        if (!editing) payload._id = visitId;

        patchOpenCustomerVisits(
            targetCustomerId,
            editing
                ? { ...editing, ...payload, _id: visitId }
                : { ...payload, createdBy: currentUser?._id || currentUser?.id, createdByName: currentUser?.displayName || currentUser?.username }
        );
        // The dashboard's list needs the customer's name and branch (the form
        // only has an id), from whatever is already loaded.
        const known = (selectedCustomer && String(selectedCustomer._id) === String(targetCustomerId) && selectedCustomer)
            || customers.find(c => String(c._id) === String(targetCustomerId)) || {};
        const optionLabel = (customerOptions || []).find(o => o.value === targetCustomerId)?.label || '';
        patchDashboardVisit(
            editing
                ? { ...payload, _id: visitId, _saving: true }
                : {
                    ...payload,
                    customerId: targetCustomerId,
                    company: known.company || known.contactName || optionLabel,
                    contactName: known.company ? (known.contactName || '') : '',
                    location: known.location || '',
                    createdByName: currentUser?.displayName || currentUser?.username,
                    _saving: true
                },
            !editing
        );
        setCurrentFollowUpPage(1);
        handleCloseVisitModal();

        visitSavesInFlight.current += 1;
        try {
            // Photos still going up finish first; one that failed to upload is
            // sent here as it was picked, and the server stores it.
            await Promise.allSettled([...visitUploadsRef.current]);
            const stored = visitUploadedRef.current;
            const linkOf = (img: unknown) => (typeof img === 'string' && stored.get(img)) || img;
            const body = {
                ...payload,
                image: Array.isArray(payload.image) ? payload.image.map(linkOf) : payload.image ? linkOf(payload.image) : payload.image
            };

            // Smart Retry Logic for cold-starts/stale connections
            let response;
            let lastError;
            const maxRetries = 1;

            for (let i = 0; i <= maxRetries; i++) {
                try {
                    response = await authFetch(url, {
                        method: editing ? 'PUT' : 'POST',
                        body: JSON.stringify(body)
                    });

                    if (response.ok) break;

                    const errorJson = await response.json().catch(() => ({}));
                    lastError = Object.assign(new Error(errorJson.message || 'Failed to save visit'), { fromServer: true });
                    // Refused or invalid (403, 400…): retrying can't change the answer.
                    if (response.status >= 400 && response.status < 500) break;
                } catch (err) {
                    lastError = err;
                }

                if (i < maxRetries) {
                    console.warn(`[Retry] Visit save attempt ${i + 1} failed. Retrying once...`);
                    await new Promise(resolve => setTimeout(resolve, 1500)); // wait 1.5s
                }
            }

            if (!response || !response.ok) {
                throw lastError || new Error('Failed to save visit');
            }

            // Both answer with the stored visit (image links and all).
            const saved = await response.json().catch(() => null);
            if (saved?.visit) patchOpenCustomerVisits(targetCustomerId, saved.visit);
            patchDashboardVisit({ ...(saved?.visit || {}), _id: visitId, _saving: false }, false);
            showSaveToast('Visit saved');
            (Array.isArray(payload.image) ? payload.image : [payload.image]).forEach((img: string) => stored.delete(img));

            // Logging a visit can add a drop-in to the calendar, hence schedules.
            refreshAfterSave(targetCustomerId, { schedules: true });
        } catch (caught) {
            const error = caught as Error & { fromServer?: boolean };
            console.error('[Visit Save Exception] Details:', {
                message: error.message,
                url,
                payload: form
            });
            // Take the visit back off the screen and give the form back.
            if (editing) {
                patchOpenCustomerVisits(targetCustomerId, editing);
                patchDashboardVisit({ ...editing, _saving: false }, false);
            } else {
                removeOpenCustomerVisit(targetCustomerId, visitId);
                removeDashboardVisit(visitId);
            }
            if (!visitModalOpenRef.current) {
                setVisitForm(form);
                setEditingVisit(editing);
                setIsViewingVisit(false);
                setShowVisitModal(true);
            }
            const why = error.fromServer ? error.message : 'Check your connection and try again.';
            showSaveToast(`Couldn’t save the visit — ${why}${visitModalOpenRef.current ? '' : ' Your entries are back in the form.'}`, 'error');
        } finally {
            visitSavesInFlight.current -= 1;
        }
    };

    const handleQuickAddVisit = () => {
        setEditingVisit(null);
        setIsViewingVisit(false);

        const localDate = formatForDateInput(new Date());

        setVisitForm({
            date: localDate,
            purpose: 'Scheduled in Person Sales Meeting',
            notes: '',
            outcome: '',
            followUp: '',
            followUpDate: '',
            managerComment: '',
            headquartersComment: '',
            image: [],
            customerId: selectedCustomerId || '' // Default to selected customer if available
        });
        setShowVisitModal(true);
    };

    // Route planner's info panel triggers these for whichever pin is open.
    // Takes the pin itself (company/contactName included) rather than just
    // an id — `customers` here is the Customers tab's current page, not the
    // full directory, so looking a route-planner pin up in it would miss
    // most customers and silently blank the resource's Client label.
    const handleAddVisitForPin = (pin: Loose | null) => {
        setEditingVisit(null);
        setIsViewingVisit(false);

        const localDate = formatForDateInput(new Date());

        setVisitForm({
            date: localDate,
            purpose: 'Scheduled in Person Sales Meeting',
            notes: '',
            outcome: '',
            followUp: '',
            followUpDate: '',
            managerComment: '',
            headquartersComment: '',
            image: [],
            customerId: pin?._id || ''
        });
        setShowVisitModal(true);
    };

    const handleDeleteVisit = async (visitId: string, customerId: string | null = null) => {
        setDeleteConfirmation({
            isOpen: true,
            type: 'visit',
            id: visitId,
            customerId: customerId || selectedCustomerId,
            message: 'Are you sure you want to delete this visit?'
        });
    };

    const handleVisitImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        const newFiles: string[] = [];
        for (const file of files) {
            if (file.size > 25 * 1024 * 1024) {
                alert(`File ${file.name} is too large. Limit is 25MB.`);
                continue;
            }
            try {
                let processedFile;
                if (file.type.startsWith('image/')) {
                    processedFile = await compressImage(file);
                } else if (file.type === 'application/pdf') {
                    processedFile = await fileToBase64(file);
                } else {
                    alert(`Unsupported file type: ${file.name}`);
                    continue;
                }
                newFiles.push(processedFile);
            } catch (error) {
                console.error(`Error processing ${file.name}:`, error);
                alert(`Failed to process file ${file.name}`);
            }
        }

        setVisitForm(prev => ({
            ...prev,
            image: prev.image ? (Array.isArray(prev.image) ? [...prev.image, ...newFiles] : [prev.image, ...newFiles]) : newFiles
        }));
        newFiles.forEach(uploadVisitAttachment);
    };

    // Sends one picked photo/PDF to the server right away; the form keeps the
    // tile (with a spinner) and swaps in the stored link when it lands. If it
    // fails nothing is lost — Save sends the photo itself, as it always did.
    const uploadVisitAttachment = (dataUrl: string) => {
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return;
        const job = (async () => {
            try {
                const res = await authFetch(`${API_URL}/api/customers/visit-attachments`, {
                    method: 'POST',
                    body: JSON.stringify({ data: dataUrl })
                });
                if (!res.ok) return;
                const { url } = await res.json();
                if (!url) return;
                visitUploadedRef.current.set(dataUrl, url);
                setVisitForm(prev => {
                    const list = Array.isArray(prev.image) ? prev.image : prev.image ? [prev.image] : [];
                    return list.includes(dataUrl) ? { ...prev, image: list.map(i => (i === dataUrl ? url : i)) } : prev;
                });
            } catch (err) {
                console.warn('[Visit photo] early upload failed; it will be sent with Save.', err);
            }
        })().finally(() => {
            visitUploadsRef.current.delete(job);
            setVisitUploading(visitUploadsRef.current.size > 0);
        });
        visitUploadsRef.current.add(job);
        setVisitUploading(true);
    };

    const handleRemoveVisitImage = (index: number) => {
        setVisitForm(prev => ({
            ...prev,
            image: prev.image.filter((_: unknown, i: number) => i !== index)
        }));
    };

    return {
        showVisitModal,
        editingVisit,
        isViewingVisit,
        visitForm,
        setVisitForm,
        visitUploading,
        loadingVisitId,
        handleEditVisit,
        handleViewVisit,
        handleCloseVisitModal,
        handleSaveVisit,
        handleQuickAddVisit,
        handleAddVisitForPin,
        handleDeleteVisit,
        handleVisitImageUpload,
        handleRemoveVisitImage,
    };
}

/** What the hook returns. */
export type VisitEditor = ReturnType<typeof useVisitEditor>;
