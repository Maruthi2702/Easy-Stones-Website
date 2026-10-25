import { Download, Eye, Link, Loader, Paperclip, Pencil, Trash2 } from 'lucide-react';
import Pagination from '../../../components/shared/Pagination';
import { formatDate } from '../../../utils/dateUtils';
import { dashboardLoadingRow } from '../components/dashboardLoadingRow';
import type { Loose } from '../../../types/records';

export type ClientResourcesProps = {
    /** Every client resource that matches the filters (all pages). */
    rows: Loose[];
    tableLoading: boolean;
    page: number;
    rowsPerPage: number;
    onPageChange: (page: number) => void;
    onRowsPerPageChange: (rows: number) => void;
    /** The resource being opened (its buttons wait). */
    loadingResourceId: string | null;
    onOpenCustomerResources: (customerId: string) => void;
    onViewResource: (resource: Loose) => void;
    onEditResource: (resource: Loose) => void;
    onDeleteResource: (resourceId: string, customerId?: string | null) => void;
    onOpenGallery: (images: string[], index: number) => void;
    onDownload: (file: Loose) => void;
};

/** Dashboard → Resources → Client Updates: the resources placed at customers, paged. */
export default function ClientResources({
    rows, tableLoading, page, rowsPerPage, onPageChange, onRowsPerPageChange, loadingResourceId, onOpenCustomerResources, onViewResource,
    onEditResource, onDeleteResource, onOpenGallery, onDownload
}: ClientResourcesProps) {
    return (
        <>


        <div className="dashboard-table-wrapper">
            <table className="dashboard-table">
                <thead>
                    <tr>
                        <th className="mobile-hide">Date</th>
                        <th>Customer</th>
                        <th>Type</th>
                        <th className="mobile-hide">Description</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    {(() => {
                        const resources = rows;
                        if (resources.length === 0 && tableLoading) {
                            return dashboardLoadingRow(5);
                        }
                        if (resources.length === 0) {
                            return (
                                <tr>
                                    <td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}>
                                        No resources found
                                    </td>
                                </tr>
                            );
                        }
                        const indexOfLastResource = page * rowsPerPage;
                        const indexOfFirstResource = indexOfLastResource - rowsPerPage;
                        const currentResources = resources.slice(indexOfFirstResource, indexOfLastResource);

                        return currentResources.map((resource, index) => (
                            <tr key={resource._id || index}>
                                <td className="mobile-hide">{formatDate(resource.date || resource.createdAt, { month: 'numeric', day: 'numeric', year: 'numeric' })}</td>
                                <td
                                    style={{ cursor: 'pointer', color: '#E5C04A', fontWeight: '500' }}
                                    onClick={() => {
                                        if (resource.customerId) {
                                            onOpenCustomerResources(resource.customerId);
                                        }
                                    }}
                                >
                                    {resource.customerName}
                                </td>
                                <td>{resource.resourceType || '-'}</td>
                                <td className="mobile-hide">{resource.description || resource.notes || '-'}</td>
                                <td>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button
                                            className="icon-btn-ghost"
                                            title="View Details"
                                            onClick={() => onViewResource(resource)}
                                            disabled={loadingResourceId === resource._id}
                                        >
                                            {loadingResourceId === resource._id ? <Loader size={16} className="animate-spin" /> : <Eye size={16} />}
                                        </button>
                                        <button
                                            className="icon-btn-ghost"
                                            title="Edit Resource"
                                            onClick={() => onEditResource(resource)}
                                            disabled={loadingResourceId === resource._id}
                                        >
                                            {loadingResourceId === resource._id ? <Loader size={16} className="animate-spin" /> : <Pencil size={16} />}
                                        </button>
                                        <button
                                            className="icon-btn-ghost delete-btn"
                                            title="Delete Resource"
                                            onClick={() => onDeleteResource(resource._id, resource.customerId)}
                                            style={{ color: '#ff4d4f' }}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                        {(Array.isArray(resource.image || resource.content) ? (resource.image || resource.content) : ((resource.image || resource.content) ? [resource.image || resource.content] : [])).length > 0 && ( /* Check if attachments exist */
                                            <button
                                                className="icon-btn-ghost"
                                                title="View Attachments"
                                                onClick={() => {
                                                    const attachments = Array.isArray(resource.image || resource.content) ? (resource.image || resource.content) : [resource.image || resource.content];
                                                    onOpenGallery(attachments, 0);
                                                }}
                                                disabled={loadingResourceId === resource._id}
                                            >
                                                {loadingResourceId === resource._id ? <Loader size={16} className="animate-spin" /> : <Paperclip size={16} />}
                                            </button>
                                        )}
                                        {resource.url ? (
                                            <a href={resource.url} target="_blank" rel="noopener noreferrer" className="icon-btn-ghost" title="Open Link">
                                                <Link size={16} />
                                            </a>
                                        ) : (resource.image) ? (
                                            <button
                                                className="icon-btn-ghost"
                                                title="Download"
                                                onClick={() => {
                                                    const img = (Array.isArray(resource.image) ? resource.image : [resource.image])[0];
                                                    if (img) onDownload({ content: img, name: `Resource-${resource.date}.jpg`, type: 'file' });
                                                }}
                                            >
                                                <Download size={16} />
                                            </button>
                                        ) : null}
                                    </div>
                                </td>
                            </tr>
                        ));
                    })()}
                </tbody>
            </table>
        </div>

        {/* Resources Pagination Controls */}
        <Pagination
             currentPage={page}
             totalPages={Math.ceil(rows.length / rowsPerPage)}
             onPageChange={(p) => { onPageChange(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
             rowsPerPage={rowsPerPage}
             onRowsPerPageChange={onRowsPerPageChange}
             totalCount={rows.length}
         />
        </>
    );
}
