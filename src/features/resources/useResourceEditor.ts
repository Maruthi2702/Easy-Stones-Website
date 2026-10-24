import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { formatForDateInput } from '../../utils/dateUtils';
import { compressImage, fileToBase64 } from '../../utils/attachmentFiles';
import type { Loose } from '../../types/records';
import type { DeleteRequest } from '../dashboard/teamFiles/useTeamFiles';

/** What the page gives the resource editor (MIGRATION_NOTES.md §4, step A4). */
export type ResourceEditorDeps = {
    selectedCustomerId: string | null;
    selectedCustomer: Loose | null;
    setIsSaving: (saving: boolean) => void;
    /** Reload what a saved resource changes (customer, dashboard, schedules). */
    refreshAfterSave: (customerId: string, options?: { dashboard?: boolean; schedules?: boolean }) => void;
    setDeleteConfirmation: (request: DeleteRequest) => void;
};

/**
 * The Add / Edit / View resource form's state and actions: opening it (new,
 * from a customer's pin, from a row), photo and PDF attachments, save, and the
 * delete check. Moved out of SalesPage unchanged (2026-10-23).
 */
export function useResourceEditor({ selectedCustomerId, selectedCustomer, setIsSaving, refreshAfterSave, setDeleteConfirmation }: ResourceEditorDeps) {
    const [showResourceModal, setShowResourceModal] = useState(false);

    const [editingResource, setEditingResource] = useState<Loose | null>(null);

    const [isViewingResource, setIsViewingResource] = useState(false);

    const [resourceForm, setResourceForm] = useState<Loose>({
        title: '',
        date: formatForDateInput(new Date()),
        customerId: '', // Added to track actual customer ID
        customer: '',
        location: '',
        resourceType: '',
        image: [], // Array of strings
        description: '',
        notes: '',
        status: 'Active',
        url: '',
        uploadedBy: ''
    });



    const [imagePreview, setImagePreview] = useState<string | null>(null);

    const [loadingResourceId, setLoadingResourceId] = useState<string | null>(null);

    const handleQuickAddResource = () => {
        setEditingResource(null);
        setIsViewingResource(false);

        const localDate = formatForDateInput(new Date());

        setResourceForm({
            title: '',
            date: localDate,
            customerId: '',
            customer: '',
            location: '',
            resourceType: '',
            image: [],
            description: '',
            notes: '',
            status: 'Active',
            url: '',
            uploadedBy: ''
        });
        setShowResourceModal(true);
    };

    const handleAddResourceForPin = (pin: Loose | null) => {
        setEditingResource(null);
        setIsViewingResource(false);
        setImagePreview(null);

        setResourceForm({
            title: '',
            date: formatForDateInput(new Date()),
            customerId: pin?._id || '',
            customer: pin ? (pin.company || pin.contactName || '') : '',
            location: '',
            resourceType: '',
            image: [],
            description: '',
            notes: '',
            status: 'Active',
            url: '',
            uploadedBy: ''
        });
        setShowResourceModal(true);
    };



    // Resource CRUD operations
    const handleCloseResourceModal = () => {
        setShowResourceModal(false);
        setEditingResource(null);
        setIsViewingResource(false);
        setResourceForm({
            title: '',
            date: formatForDateInput(new Date()),
            customerId: selectedCustomer ? selectedCustomer._id : '',
            customer: selectedCustomer ? (selectedCustomer.company || selectedCustomer.contactName) : '',
            location: '',
            resourceType: '',
            image: [],
            description: '',
            notes: '',
            status: 'Active',
            url: '',
            uploadedBy: ''
        });
    };

    const handleAddResource = () => {
        setEditingResource(null);
        setIsViewingResource(false);
        setImagePreview(null);
        setResourceForm({
            title: '',
            date: formatForDateInput(new Date()),
            customerId: selectedCustomer ? selectedCustomer._id : '',
            customer: selectedCustomer ? (selectedCustomer.company || selectedCustomer.contactName) : '',
            location: '',
            resourceType: '',
            image: [],
            description: '',
            notes: '',
            status: 'Active',
            url: '',
            uploadedBy: ''
        });
        setShowResourceModal(true);
    };


    const handleEditResource = async (resource: Loose) => {
        if (!resource?.customerId || !resource?._id) {
            setEditingResource(resource);
            setIsViewingResource(false);
            setImagePreview(Array.isArray(resource.image) && resource.image.length > 0 ? resource.image[0] : (resource.image || null));
            setResourceForm({
                title: resource.title || '',
                date: resource.date ? formatForDateInput(resource.date) : formatForDateInput(new Date()),
                customerId: resource.customerId || selectedCustomerId, // Fallback to current if missing
                customer: resource.customer || '',
                location: resource.location || '',
                resourceType: resource.resourceType || '',
                image: Array.isArray(resource.image) ? resource.image : (resource.image ? [resource.image] : []),
                description: resource.description || '',
                notes: resource.notes || '',
                status: resource.status || 'Active',
                url: resource.url || '',
                uploadedBy: resource.uploadedBy || ''
            });
            setShowResourceModal(true);
            return;
        }

        setLoadingResourceId(resource._id);
        try {
            const response = await authFetch(`${API_URL}/api/customers/${resource.customerId}/resources/${resource._id}`);
            const data = await response.json();

            if (data && data.resource) {
                const formattedResource = {
                    ...data.resource,
                    customerId: resource.customerId, // Preserve customerId
                    date: formatForDateInput(data.resource.date)
                };
                setResourceForm(formattedResource);
                setEditingResource(formattedResource);
                setImagePreview(Array.isArray(data.resource.image) && data.resource.image.length > 0 ? data.resource.image[0] : (data.resource.image || null));
            } else {
                const formattedResource = {
                    ...resource,
                    date: formatForDateInput(resource.date)
                };
                setResourceForm(formattedResource);
                setEditingResource(formattedResource);
                setImagePreview(Array.isArray(resource.image) && resource.image.length > 0 ? resource.image[0] : (resource.image || null));
            }
            setIsViewingResource(false);
            setShowResourceModal(true);
        } catch (error) {
            console.error('Error fetching resource details for edit:', error);
            setResourceForm(resource);
            setEditingResource(resource);
            setIsViewingResource(false);
            setShowResourceModal(true);
        } finally {
            setLoadingResourceId(null);
        }
    };

    const handleViewResource = async (resource: Loose) => {
        if (!resource?.customerId || !resource?._id) {
            setResourceForm(resource || {});
            setEditingResource(resource);
            setImagePreview(Array.isArray(resource.image) && resource.image.length > 0 ? resource.image[0] : (resource.image || null));
            setShowResourceModal(true);
            setIsViewingResource(true);
            return;
        }

        setLoadingResourceId(resource._id);
        try {
            const response = await authFetch(`${API_URL}/api/customers/${resource.customerId}/resources/${resource._id}`);
            const data = await response.json();

            if (data && data.resource) {
                const formattedResource = {
                    ...data.resource,
                    customerId: resource.customerId, // Preserve customerId
                    date: formatForDateInput(data.resource.date)
                };
                setResourceForm(formattedResource);
                setEditingResource(formattedResource);
                const getFirstImage = (imgData: unknown) => {
                    if (!imgData) return null;
                    if (Array.isArray(imgData)) return imgData[0];
                    if (typeof imgData === 'string') {
                        if (imgData.startsWith('[') && imgData.endsWith(']')) {
                            try { return JSON.parse(imgData)[0]; } catch { /* not fatal — carry on */ }
                        }
                        return imgData.split(',')[0].trim();
                    }
                    return null;
                };

                const firstImg = getFirstImage(data.resource.image);
                setImagePreview(firstImg);
            } else {
                const formattedResource = {
                    ...resource,
                    date: formatForDateInput(resource.date)
                };
                setResourceForm(formattedResource);
                setEditingResource(formattedResource);

                const getFirstImage = (imgData: unknown) => {
                    if (!imgData) return null;
                    if (Array.isArray(imgData)) return imgData[0];
                    if (typeof imgData === 'string') {
                        if (imgData.startsWith('[') && imgData.endsWith(']')) {
                            try { return JSON.parse(imgData)[0]; } catch { /* not fatal — carry on */ }
                        }
                        return imgData.split(',')[0].trim();
                    }
                    return null;
                };
                setImagePreview(getFirstImage(resource.image));
            }
            setShowResourceModal(true);
            setIsViewingResource(true);
        } catch (error) {
            console.error('Error fetching resource details:', error);
            setResourceForm(resource);
            setEditingResource(resource);
            setShowResourceModal(true);
            setIsViewingResource(true);
        } finally {
            setLoadingResourceId(null);
        }
    };

    const handleSaveResource = async () => {
        try {
            setIsSaving(true);
            // Use the selected customer ID from the form, or fallback to the currently selected customer
            const targetCustomerId = resourceForm.customerId || selectedCustomerId;

            if (!targetCustomerId) {
                alert('Please select a client');
                setIsSaving(false);
                return;
            }

            const url = editingResource
                ? `${API_URL}/api/customers/${targetCustomerId}/resources/${editingResource._id}`
                : `${API_URL}/api/customers/${targetCustomerId}/resources`;

            const method = editingResource ? 'PUT' : 'POST';


            const response = await authFetch(url, {
                method,
                body: JSON.stringify(resourceForm)
            });

            if (response.ok) {
                handleCloseResourceModal();
                // A placement writes its own visit, which can add a drop-in
                // to the calendar — hence schedules.
                refreshAfterSave(targetCustomerId, { schedules: true });
            } else {
                const data = await response.json();
                console.error('Save resource failed:', data);
                alert(`Failed to save resource: ${data.message || 'Unknown server error'}`);
            }
        } catch (error) {
            console.error('Error saving resource:', error);
            alert(`Failed to save resource: ${(error as Error).message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteResource = async (resourceId: string, customerId: string | null = null) => {
        setDeleteConfirmation({
            isOpen: true,
            type: 'resource',
            id: resourceId,
            customerId: customerId || selectedCustomerId,
            message: 'Are you sure you want to delete this resource?'
        });
    };

    // Resource Image/File upload handler
    const handleResourceImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
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

        if (newFiles.length === 0) return;

        setResourceForm(prev => ({
            ...prev,
            image: prev.image ? (Array.isArray(prev.image) ? [...prev.image, ...newFiles] : [prev.image, ...newFiles]) : newFiles
        }));

        // Set preview for the first file if not already set
        if (!imagePreview && newFiles.length > 0) {
            setImagePreview(newFiles[0]);
        }
    };

    const handleRemoveResourceImage = (index: number) => {
        const updatedImages = resourceForm.image.filter((_: unknown, i: number) => i !== index);
        setResourceForm({ ...resourceForm, image: updatedImages });
        setImagePreview(updatedImages.length > 0 ? updatedImages[0] : null);
    };

    return {
        showResourceModal,
        setShowResourceModal,
        editingResource,
        isViewingResource,
        resourceForm,
        setResourceForm,
        loadingResourceId,
        handleQuickAddResource,
        handleAddResourceForPin,
        handleAddResource,
        handleEditResource,
        handleViewResource,
        handleSaveResource,
        handleDeleteResource,
        handleResourceImageUpload,
        handleRemoveResourceImage,
    };
}

/** What the hook returns. */
export type ResourceEditor = ReturnType<typeof useResourceEditor>;
