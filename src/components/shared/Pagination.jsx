import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import './Pagination.css';

/**
 * Reusable Pagination component.
 * Props:
 *   currentPage  {number}   – current active page (1-indexed)
 *   totalPages   {number}   – total number of pages
 *   onPageChange {function} – called with new page number
 *   totalCount   {number}   – optional total item count to show
 *   itemLabel    {string}   – optional label for items e.g. "partners", "visits"
 */
const Pagination = ({ currentPage, totalPages, onPageChange, totalCount, itemLabel = 'items' }) => {
    if (!totalPages || totalPages <= 1) return null;

    return (
        <div className="shared-pagination">
            <button
                className="shared-pagi-btn"
                onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                title="Previous Page"
            >
                <ChevronLeft size={16} />
                <span>Previous</span>
            </button>

            <span className="shared-pagi-info">
                Page {currentPage} of {totalPages}
                {totalCount != null && (
                    <span className="shared-pagi-count"> · {totalCount} {itemLabel}</span>
                )}
            </span>

            <button
                className="shared-pagi-btn"
                onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                title="Next Page"
            >
                <span>Next</span>
                <ChevronRight size={16} />
            </button>
        </div>
    );
};

export default Pagination;
