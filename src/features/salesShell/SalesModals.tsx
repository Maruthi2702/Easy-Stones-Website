import type { ComponentType } from 'react';
import Toast from '../../components/shared/Toast';
import ImageGallery from '../../components/shared/ImageGallery';
import DeleteConfirmModal from '../../components/shared/DeleteConfirmModal';
import type { ImageGalleryState } from '../../components/shared/useImageGallery';
import VisitCustomerCardJs from '../../components/sales/VisitCustomerCard';
import VisitModalJs from '../../components/sales/VisitModal';
import ResourceModalJs from '../../components/sales/ResourceModal';
import AddCustomerModalJs from '../customers/form/AddCustomerModal';
import { API_URL } from '../../config/api';
import { formatDate } from '../../utils/dateUtils';
import { canViewCustomerProfile } from '../../utils/customerAccess';
import { canDeleteVisit } from '../../utils/visitAccess';
import { CalendarSyncModal } from '../calendarSync';
import type { CalendarSync } from '../calendarSync';
import { CheckInDetailModal } from '../checkin';
import type { CheckInLog } from '../checkin';
import { ContactModal, LinkPartnerModal } from '../customers';
import type { CustomerActions } from '../customers';
import { TeamFilePreview, TeamFileUploadModal, AddFolderModal } from '../dashboard';
import type { TeamFiles } from '../dashboard';
import type { VisitEditor } from '../visits';
import { RESOURCE_TYPES } from '../resources';
import type { ResourceEditor } from '../resources';
import type { DeleteRequest } from './deleteCheck';
import type { Loose } from '../../types/records';

// Still JavaScript; TypeScript reads their `= null` defaults as the only values
// allowed, so they're taken as taking any props until they're typed.
const VisitCustomerCard = VisitCustomerCardJs as unknown as ComponentType<Loose>;
const VisitModal = VisitModalJs as unknown as ComponentType<Loose>;
const ResourceModal = ResourceModalJs as unknown as ComponentType<Loose>;
const AddCustomerModal = AddCustomerModalJs as unknown as ComponentType<Loose>;

export type SalesModalsProps = {
    currentUser: Loose | null;
    currentUserId: string | null;
    selectedCustomer: Loose | null;
    /** The page's first page of customers (names in the forms). */
    customers: Loose[];
    customerOptions: Loose[];
    /** Link Partner's choices: not this customer, not already linked. */
    linkableCustomerOptions: Loose[];
    isDropdownLoading: boolean;
    isSaving: boolean;
    salesReps: Loose[];
    locations: Loose[];
    /** "New customer" in a dropdown; undefined when they may not add one. */
    onCreateNew?: () => void;
    visits: VisitEditor;
    resources: ResourceEditor;
    actions: CustomerActions;
    teamFiles: TeamFiles;
    gallery: ImageGalleryState;
    checkInLog: CheckInLog;
    toast: { toast: unknown; onDismiss: () => void };
    /** The basic card from a dashboard visit's customer name. */
    visitCard: { visit: Loose | null; onClose: () => void; onOpenProfile: (customer: Loose) => void };
    calendar: { open: boolean; sync: CalendarSync; onClose: () => void };
    addCustomer: { show: boolean; prefill: Loose | null; onClose: () => void; onSave: (form: Loose, close: () => void) => void };
    deleteCheck: { request: DeleteRequest; onConfirm: () => void; onCancel: () => void };
};

/**
 * Every pop-up the Sales page can show, in the order the page always
 * rendered them (later ones sit on top): team file preview, contact, the save
 * toast, the visit's customer card, the visit form, calendar sync, link
 * partner, the resource form, the photo viewer, add customer, team file upload
 * and folder, the delete check and the check-in detail. Moved out of
 * SalesPage unchanged (2026-10-24).
 */
export default function SalesModals(p: SalesModalsProps) {
    const { visits, resources, actions, teamFiles, gallery, currentUser, currentUserId, selectedCustomer } = p;
    const { editingVisit } = visits;
    return (
        <>
            {/* Dashboard Resource Preview Modal */}
            {teamFiles.previewDashboardResource && (
                <TeamFilePreview
                    resource={teamFiles.previewDashboardResource}
                    onClose={() => teamFiles.setPreviewDashboardResource(null)}
                    onDownload={teamFiles.handleDashboardDownload}
                />
            )}

            {/* Contact Modal */}
            {actions.showContactModal && (
                <ContactModal
                    form={actions.contactForm}
                    onChange={actions.setContactForm}
                    isEditing={Boolean(actions.editingContact)}
                    isSaving={p.isSaving}
                    onSave={actions.handleSaveContact}
                    onClose={() => actions.setShowContactModal(false)}
                />
            )}

            <Toast toast={p.toast.toast as never} onDismiss={p.toast.onDismiss} />
            {/* Visit Modal, and the basic card from a dashboard visit's customer name */}
            {p.visitCard.visit && (
                <VisitCustomerCard
                    visit={p.visitCard.visit}
                    canProfile={canViewCustomerProfile(currentUser)}
                    onClose={p.visitCard.onClose}
                    onOpenProfile={p.visitCard.onOpenProfile}
                />
            )}
            <VisitModal
                showVisitModal={visits.showVisitModal}
                isViewingVisit={visits.isViewingVisit}
                handleCloseVisitModal={visits.handleCloseVisitModal}
                editingVisit={editingVisit}
                visitForm={visits.visitForm}
                setVisitForm={visits.setVisitForm}
                customerOptions={p.customerOptions}
                isDropdownLoading={p.isDropdownLoading}
                isSaving={p.isSaving}
                handleSaveVisit={visits.handleSaveVisit}
                handleVisitImageUpload={visits.handleVisitImageUpload}
                visitUploading={visits.visitUploading}
                handleRemoveVisitImage={visits.handleRemoveVisitImage}
                selectedCustomer={selectedCustomer}
                customers={p.customers}
                handleDashboardDownload={teamFiles.handleDashboardDownload}
                setFullScreenImage={gallery.setFullScreenImage}
                handleOpenGallery={gallery.handleOpenGallery}
                onCreateNew={p.onCreateNew}
                suspended={p.addCustomer.show}
                // Users & Roles → Visits → Delete own / branch / all (visitAccess.js).
                canDelete={Boolean(editingVisit?._id) && canDeleteVisit(
                    { ...currentUser, id: currentUserId },
                    editingVisit,
                    editingVisit?.location || (selectedCustomer?._id === editingVisit?.customerId ? selectedCustomer?.location : undefined)
                )}
                // The form closes first: the delete check is a page modal and
                // would otherwise open underneath it.
                onDelete={() => {
                    const { _id, customerId } = editingVisit!;
                    visits.handleCloseVisitModal();
                    visits.handleDeleteVisit(_id, customerId);
                }}
            />

            {/* Calendar Sync Modal (src/features/calendarSync) */}
            {p.calendar.open && (
                <CalendarSyncModal sync={p.calendar.sync} userId={currentUserId} onClose={p.calendar.onClose} />
            )}

            {/* Link Partner Modal */}
            {actions.showLinkPartnerModal && (
                <LinkPartnerModal
                    options={p.linkableCustomerOptions as never}
                    value={actions.linkingPartnerId}
                    onChange={actions.setLinkingPartnerId}
                    loading={p.isDropdownLoading}
                    linking={actions.isLinkingInProgress}
                    onSubmit={actions.handleLinkPartner}
                    onClose={() => { actions.setShowLinkPartnerModal(false); actions.setLinkingPartnerId(''); }}
                />
            )}

            <ResourceModal
                showResourceModal={resources.showResourceModal}
                setShowResourceModal={resources.setShowResourceModal}
                editingResource={resources.editingResource}
                isViewingResource={resources.isViewingResource}
                resourceForm={resources.resourceForm}
                setResourceForm={resources.setResourceForm}
                customerOptions={p.customerOptions}
                isDropdownLoading={p.isDropdownLoading}
                customers={p.customers}
                resourceTypes={RESOURCE_TYPES}
                formatDate={formatDate}
                API_URL={API_URL}
                isSaving={p.isSaving}
                handleSaveResource={resources.handleSaveResource}
                handleResourceImageUpload={resources.handleResourceImageUpload}
                handleRemoveResourceImage={resources.handleRemoveResourceImage}
                handleDashboardDownload={teamFiles.handleDashboardDownload}
                setFullScreenImage={gallery.setFullScreenImage}
                handleOpenGallery={gallery.handleOpenGallery}
                onCreateNew={p.onCreateNew}
            />

            {gallery.fullScreenImage && (
                <ImageGallery
                    image={gallery.fullScreenImage}
                    index={gallery.fullScreenIndex}
                    count={gallery.galleryCount}
                    onPrev={gallery.handlePrevImage}
                    onNext={gallery.handleNextImage}
                    onClose={gallery.closeGallery}
                />
            )}

            <AddCustomerModal
                show={p.addCustomer.show}
                onClose={p.addCustomer.onClose}
                prefill={p.addCustomer.prefill}
                onSave={p.addCustomer.onSave}
                isSaving={p.isSaving}
                salesReps={p.salesReps}
                locations={p.locations.map(loc => loc.name).filter(Boolean)}
                currentUser={currentUser}
            />

            {/* Dashboard Upload Modal */}
            {teamFiles.showDashboardUploadModal && (
                <TeamFileUploadModal
                    form={teamFiles.dashboardUploadForm}
                    onChange={teamFiles.setDashboardUploadForm}
                    onUpload={teamFiles.handleDashboardUpload}
                    onClose={() => teamFiles.setShowDashboardUploadModal(false)}
                />
            )}

            {/* Add Folder Modal */}
            {teamFiles.showAddFolderModal && (
                <AddFolderModal
                    name={teamFiles.folderName}
                    onNameChange={teamFiles.setFolderName}
                    onCreate={teamFiles.handleCreateFolder}
                    onClose={() => teamFiles.setShowAddFolderModal(false)}
                />
            )}

            {/* Custom Delete Confirmation Modal */}
            {p.deleteCheck.request.isOpen && (
                <DeleteConfirmModal request={p.deleteCheck.request} onConfirm={p.deleteCheck.onConfirm} onCancel={p.deleteCheck.onCancel} />
            )}

            {/* Check-In Detail/Edit Modal (src/features/checkin) */}
            <CheckInDetailModal log={p.checkInLog} locations={p.locations} currentUser={currentUser} />
        </>
    );
}
