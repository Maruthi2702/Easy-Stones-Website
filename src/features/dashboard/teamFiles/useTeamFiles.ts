import { useEffect, useState } from 'react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import type { Loose } from '../../../types/records';

/** The page's delete check (a team file or folder asks it before deleting). */
export type DeleteRequest = { isOpen: boolean; isDeleting?: boolean; type: string; id: string | null; customerId?: string | null; message: string };

/** The Upload / Edit file form. */
export type TeamFileForm = { name: string; type: string; content: string; file: File | null };

export type TeamFilesDeps = {
    /** Whether the dashboard is the screen showing (the list loads only then). */
    showDashboard: boolean;
    /** The Resources tab's sub-tab: 'client' or 'team'. */
    activeResourceSubTab: string;
    /** Bumped when resources change (socket), to refetch. */
    resourceRefreshTrigger: number;
    setIsSaving: (saving: boolean) => void;
    fetchDashboardData: () => unknown;
    fetchDashboardStats: () => unknown;
    setDeleteConfirmation: (request: DeleteRequest) => void;
};

/**
 * The dashboard's Team Files (Resources → Team Files): folders and files
 * shared with the whole team — browse, upload, edit, preview, download and
 * delete. Moved out of SalesPage unchanged (2026-10-23). `handleDashboardDownload`
 * is also how the visit and resource forms download an attachment.
 */
export function useTeamFiles({ showDashboard, activeResourceSubTab, resourceRefreshTrigger, setIsSaving, fetchDashboardData, fetchDashboardStats, setDeleteConfirmation }: TeamFilesDeps) {
    const [showAddFolderModal, setShowAddFolderModal] = useState(false);
    const [folderName, setFolderName] = useState('');

    const [salesResources, setSalesResources] = useState<Loose[]>([]);

    const [showDashboardUploadModal, setShowDashboardUploadModal] = useState(false);

    const [dashboardUploadForm, setDashboardUploadForm] = useState<TeamFileForm>({
        name: '',
        type: 'file',
        content: '',
        file: null
    });
    const [editingDashboardResource, setEditingDashboardResource] = useState<Loose | null>(null);
    const [previewDashboardResource, setPreviewDashboardResource] = useState<Loose | null>(null);
    const [isExistingFileRemoved, setIsExistingFileRemoved] = useState(false);
    const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
    const [folderPath, setFolderPath] = useState<{ id: string; name: string }[]>([]);

    // Fetch Sales Dashboard Resources
    const fetchDashboardResources = async () => {
        try {
            const query = currentFolderId ? `?parentId=${currentFolderId}` : '';
            const url = `${API_URL}/api/sales-dashboard/resources${query}`;

            const response = await authFetch(url);
            if (response.ok) {
                const data = await response.json();

                setSalesResources(data);
            } else {
                console.error('❌ [FETCH] Failed to fetch resources:', response.status, response.statusText);
            }
        } catch (error) {
            console.error('❌ [FETCH] Error fetching dashboard resources:', error);
        }
    };

    useEffect(() => {
        if (showDashboard && activeResourceSubTab === 'team') {
            fetchDashboardResources();
        }
    }, [showDashboard, currentFolderId, activeResourceSubTab, resourceRefreshTrigger]);

    const handleDashboardUpload = async (e: { preventDefault: () => void }) => {
        e.preventDefault();

        // Validation: For NEW resources of type file, file is required.
        // For EDITING, file is optional UNLESS the existing one was explicitly removed.
        if (dashboardUploadForm.type === 'file') {
            if (!dashboardUploadForm.file) {
                if (!editingDashboardResource || isExistingFileRemoved) {
                    alert('Please select a file to upload');
                    return;
                }
            }
        }

        // Basic validation for name
        if (!dashboardUploadForm.name.trim()) {
            alert('Please provide a name for the resource.');
            return;
        }

        // Validation for link type
        if (dashboardUploadForm.type === 'link' && !dashboardUploadForm.content.trim()) {
            alert('Please provide a URL for the link resource.');
            return;
        }

        setIsSaving(true);
        try {
            const formData = new FormData();
            formData.append('name', dashboardUploadForm.name);
            formData.append('type', dashboardUploadForm.type);
            if (currentFolderId) {
                formData.append('parentId', currentFolderId);
            }

            if (dashboardUploadForm.type === 'link') {
                formData.append('content', dashboardUploadForm.content);
            } else if (dashboardUploadForm.file) { // Only append file if it exists (for new or updated files)
                formData.append('file', dashboardUploadForm.file);

                // Client-side thumbnail generation for images
                if (dashboardUploadForm.file.type.startsWith('image/')) {
                    try {
                        const createThumbnail = (file: File) => {
                            return new Promise<string>((resolve) => {
                                const reader = new FileReader();
                                reader.onload = (e) => {
                                    const img = new Image();
                                    img.onload = () => {
                                        const canvas = document.createElement('canvas');
                                        const MAX_WIDTH = 200;
                                        const scaleSize = MAX_WIDTH / img.width;
                                        canvas.width = MAX_WIDTH;
                                        canvas.height = img.height * scaleSize;
                                        const ctx = canvas.getContext('2d')!;
                                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                                        resolve(canvas.toDataURL(file.type));
                                    };
                                    img.src = e.target!.result as string;
                                };
                                reader.readAsDataURL(file);
                            });
                        };

                        const thumbDataUrl = await createThumbnail(dashboardUploadForm.file as File);
                        formData.append('thumbnail', thumbDataUrl);
                    } catch (error) {
                        console.error('Thumbnail generation failed:', error);
                    }
                }
            }

            const url = editingDashboardResource
                ? `/api/sales-dashboard/resources/${editingDashboardResource._id}`
                : '/api/sales-dashboard/upload';

            const method = editingDashboardResource ? 'PUT' : 'POST';

            const response = await authFetch(url, {
                method: method,
                body: formData // Content-Type is set automatically
            });
            if (response.ok) {
                await response.json();

                setShowDashboardUploadModal(false);
                setDashboardUploadForm({ name: '', type: 'file', content: '', file: null });
                setEditingDashboardResource(null);

                fetchDashboardResources();
                // Refresh dashboard data and stats
                fetchDashboardData();
                fetchDashboardStats();
            } else {
                const errorData = await response.json();
                alert(`Failed to ${editingDashboardResource ? 'update' : 'upload'} resource: ${errorData.message}`);
            }
        } catch (error) {
            console.error('Upload/Update error:', error);
            alert(`Error processing request: ${(error as Error).message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const ensureResourceContent = async (resource: Loose): Promise<Loose> => {
        if (resource.isFolder || resource.type === 'link') return resource;
        if (resource.content) return resource;

        try {
            const response = await authFetch(`${API_URL}/api/sales-dashboard/resources/${resource._id}`);
            if (response.ok) {
                const fullResource = await response.json();
                // Update local list state so we don't have to fetch again
                setSalesResources((prev: Loose[]) => prev.map((r: Loose) => r._id === fullResource._id ? fullResource : r));
                return fullResource;
            }
        } catch (error) {
            console.error('Error fetching full resource:', error);
        }
        return resource;
    };

    const handleDashboardDownload = async (resource: Loose) => {
        const fullResource = await ensureResourceContent(resource);
        if (fullResource.type === 'link') {
            window.open(fullResource.content, '_blank');
        } else {
            const link = document.createElement('a');
            link.href = fullResource.content.startsWith('data:')
                ? fullResource.content
                : (fullResource.content.startsWith('/') ? `${API_URL}${fullResource.content}` : fullResource.content);
            link.download = fullResource.name || 'download';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    const handleDashboardPreview = async (resource: Loose) => {
        const fullResource = await ensureResourceContent(resource);
        if (fullResource.type === 'link') {
            window.open(fullResource.content, '_blank');
        } else {
            setPreviewDashboardResource(fullResource);
        }
    };

    const handleCreateFolder = async () => {
        if (!folderName || !folderName.trim()) {
            alert('Please enter a folder name');
            return;
        }

        try {
            const response = await authFetch(`${API_URL}/api/sales-dashboard/upload`, {
                method: 'POST',
                body: JSON.stringify({
                    name: folderName.trim(),
                    type: 'folder',
                    isFolder: true,
                    parentId: currentFolderId
                })
            });

            if (response.ok) {
                fetchDashboardResources();
            } else {
                alert('Failed to create folder');
            }
        } catch (error) {
            console.error('Error creating folder:', error);
            alert('Error creating folder');
        }
    };

    const handleFolderClick = (folder: Loose) => {
        setFolderPath([...folderPath, { id: folder._id, name: folder.name }]);
        setCurrentFolderId(folder._id);
    };



    const handleEditDashboardResource = (resource: Loose) => {
        setEditingDashboardResource(resource);
        setDashboardUploadForm({
            name: resource.name,
            type: resource.type,
            content: resource.type === 'link' ? resource.content : '',
            file: null
        });
        setIsExistingFileRemoved(false);
        setShowDashboardUploadModal(true);
    };

    const handleDeleteDashboardResource = async (resourceId: string) => {
        setDeleteConfirmation({
            isOpen: true,
            isDeleting: false,
            type: 'dashboardResource',
            id: resourceId,
            message: 'Are you sure you want to delete this resource? If it is a folder, all its contents will be deleted.'
        });
    };



    const handleBreadcrumbClick = (index: number) => {
        if (index === -1) {
            // Home
            setFolderPath([]);
            setCurrentFolderId(null);
        } else {
            // Go to specific folder
            const newPath = folderPath.slice(0, index + 1);
            setFolderPath(newPath);
            setCurrentFolderId(newPath[newPath.length - 1].id);
        }
    };

    const handleResourceClick = async (resource: Loose) => {
        if (resource.isFolder) {
            handleFolderClick(resource);
        } else {
            // Lazy load content if missing
            let fullResource = resource;
            if (!resource.content && resource.type !== 'link') {
                try {
                    const response = await authFetch(`${API_URL}/api/sales-dashboard/resources/${resource._id}`);
                    if (response.ok) {
                        fullResource = await response.json();
                        // Update local state to avoid re-fetching immediately (optional optimization)
                        setSalesResources((prev: Loose[]) => prev.map((r: Loose) => r._id === fullResource._id ? fullResource : r));
                    } else {
                        alert('Failed to load resource content');
                        return;
                    }
                } catch (error) {
                    console.error('Error fetching full resource:', error);
                    alert('Error loading resource');
                    return;
                }
            }
            handleDashboardPreview(fullResource);
        }
    };

    return {
        showAddFolderModal,
        setShowAddFolderModal,
        folderName,
        setFolderName,
        salesResources,
        showDashboardUploadModal,
        setShowDashboardUploadModal,
        dashboardUploadForm,
        setDashboardUploadForm,
        setEditingDashboardResource,
        previewDashboardResource,
        setPreviewDashboardResource,
        setCurrentFolderId,
        folderPath,
        setFolderPath,
        fetchDashboardResources,
        handleDashboardUpload,
        handleDashboardDownload,
        handleCreateFolder,
        handleEditDashboardResource,
        handleDeleteDashboardResource,
        handleBreadcrumbClick,
        handleResourceClick,
    };
}
