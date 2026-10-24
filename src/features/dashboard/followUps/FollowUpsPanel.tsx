import { Calendar, Download, Eye, Pencil, Search } from 'lucide-react';
import LocationFilter from '../../../components/shared/LocationFilter';
import Pagination from '../../../components/shared/Pagination';
import { formatDate } from '../../../utils/dateUtils';
import { dashboardLoadingRow } from '../components/dashboardLoadingRow';
import type { Loose } from '../../../types/records';

export type FollowUpsPanelProps = {
    /** Every follow-up note and planner stop that matches the filters (all pages). */
    rows: Loose[];
    filter: 'all' | 'nextWeek';
    /** Also takes the list back to page 1. */
    onFilterChange: (filter: 'all' | 'nextWeek') => void;
    locationOptions: string[];
    location: string;
    onLocationChange: (value: string) => void;
    currentUser: Loose | null;
    searchTerm: string;
    onSearchChange: (value: string) => void;
    page: number;
    rowsPerPage: number;
    onPageChange: (page: number) => void;
    onRowsPerPageChange: (rows: number) => void;
    tableLoading: boolean;
    onExport: () => void;
    onOpenPlanner: () => void;
    onViewVisit: (visit: Loose) => void;
    onEditVisit: (visit: Loose) => void;
    /** A customer's profile (also leaves the dashboard). */
    onOpenCustomer: (customerId: string) => void;
};

/** Dashboard → Follow-up: the follow-up notes and planner stops, filtered and paged. */
export default function FollowUpsPanel({
    rows, filter, onFilterChange, locationOptions, location, onLocationChange, currentUser, searchTerm, onSearchChange, page, rowsPerPage,
    onPageChange, onRowsPerPageChange, tableLoading, onExport, onOpenPlanner, onViewVisit, onEditVisit, onOpenCustomer
}: FollowUpsPanelProps) {
    return (
        <div className="visits-table-section">
            <div className="section-header">
                <h2>Follow-up Actions</h2>
                <div className="table-controls">
                    <div className="dashboard-sub-tabs" style={{ marginBottom: 0, border: 'none' }}>
                        <button
                            className={`sub-tab-btn ${filter === 'all' ? 'active' : ''}`}
                            onClick={() => {
                                onFilterChange('all');
                            }}
                            style={{ padding: '0.5rem 1rem' }}
                        >
                            All Notes
                        </button>
                        <button
                            className={`sub-tab-btn ${filter === 'nextWeek' ? 'active' : ''}`}
                            onClick={() => {
                                onFilterChange('nextWeek');
                            }}
                            style={{ padding: '0.5rem 1rem' }}
                        >
                            Next Week
                        </button>
                    </div>
                    <LocationFilter
                        options={locationOptions}
                        value={location}
                        onChange={onLocationChange}
                        user={currentUser}
                    />
                    <button className="export-btn" onClick={() => {
                        onExport();
                    }}>
                        <Download size={18} /> Excel
                    </button>
                    <div className="table-search">
                         <Search className="search-icon" size={18} />
                         <input
                             type="text"
                             placeholder="Search follow-ups..."
                            value={searchTerm}
                            onChange={(e) => onSearchChange(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <div className="dashboard-table-wrapper">
                <table className="dashboard-table">
                    <thead>
                        <tr>
                            <th className="mobile-hide">Date</th>
                            <th>Customer</th>
                            <th>Action Item / Note</th>
                            <th className="mobile-hide">Source</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(() => {
                            const followups = rows;

                            if (followups.length === 0 && tableLoading) {
                                return dashboardLoadingRow(5);
                            }
                            if (followups.length === 0) {
                                return (
                                    <tr>
                                        <td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}>
                                            {filter === 'nextWeek' ? 'No follow-ups scheduled for next week' : 'No follow-up notes found'}
                                        </td>
                                    </tr>
                                );
                            }
                            const indexOfLastItem = page * rowsPerPage;
                            const indexOfFirstItem = indexOfLastItem - rowsPerPage;
                            const currentItems = followups.slice(indexOfFirstItem, indexOfLastItem);

                            return currentItems.map((item, index) => (
                                <tr key={item._id || index}>
                                    <td className="mobile-hide">{formatDate(item.displayDate, { month: 'numeric', day: 'numeric', year: 'numeric' })}</td>
                                    <td>
                                        <span
                                            className="link"
                                            onClick={() => {
                                                onOpenCustomer(item.customerId);
                                            }}
                                        >
                                            {item.customerName}
                                        </span>
                                    </td>
                                    <td>
                                        <div title={item.displayNote} style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {item.displayNote}
                                        </div>
                                    </td>
                                    <td className="mobile-hide">
                                        <span className={`status-badge ${item.source === 'Planner' ? 'completed' : 'pending'}`}>
                                            {item.source}
                                        </span>
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            {item.isSchedule ? (
                                                <button
                                                    className="icon-btn-ghost"
                                                    onClick={() => onOpenPlanner()}
                                                    title="View in Planner"
                                                >
                                                    <Calendar size={16} />
                                                </button>
                                            ) : (
                                                <>
                                                    <button
                                                        className="icon-btn-ghost"
                                                        onClick={() => onViewVisit(item)}
                                                        title="View Details"
                                                    >
                                                        <Eye size={16} />
                                                    </button>
                                                    <button
                                                        className="icon-btn-ghost"
                                                        onClick={() => onEditVisit(item)}
                                                        title="Edit Visit"
                                                    >
                                                        <Pencil size={16} />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ));
                        })()}
                    </tbody>
                </table>
            </div>

            {/* Follow-up Pagination Controls */}
            <Pagination
                 currentPage={page}
                 totalPages={Math.ceil(rows.length / rowsPerPage)}
                 onPageChange={(p) => {
                     onPageChange(p);
                     const el = document.querySelector('.dashboard-content-area') || document.querySelector('.sales-dashboard-main');
                     if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
                     else window.scrollTo({ top: 0, behavior: 'smooth' });
                 }}
                 rowsPerPage={rowsPerPage}
                 onRowsPerPageChange={onRowsPerPageChange}
                 totalCount={rows.length}
             />
        </div>
    );
}
