import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import './Pagination.css';

/**
 * Reusable Pagination component – used site-wide.
 *
 * Props:
 *   currentPage  {number}    – current active page (1-indexed)
 *   totalPages   {number}    – total number of pages
 *   onPageChange {function}  – called with new page number
 *   totalCount   {number}    – optional total item count to display
 *   itemLabel    {string}    – label for items e.g. "partners", "visits" (default: "items")
 *   showJump     {boolean}   – show the Go-to-page input (default: true when totalPages > 3)
 */
const Pagination = ({
    currentPage,
    totalPages,
    onPageChange,
    totalCount,
    itemLabel = 'items',
    showJump,
}) => {
    const [jumpValue, setJumpValue] = useState('');

    // Sync input if the page changes externally
    useEffect(() => {
        setJumpValue('');
    }, [currentPage]);

    if (!totalPages || totalPages <= 1) return null;

    // Show jump input when there are more than 3 pages (or forced via prop)
    const shouldShowJump = showJump !== undefined ? showJump : totalPages > 3;

    const handleJumpChange = (e) => {
        const val = e.target.value;
        if (val === '' || /^\d+$/.test(val)) setJumpValue(val);
    };

    const commitJump = () => {
        const page = parseInt(jumpValue, 10);
        if (!isNaN(page) && page >= 1 && page <= totalPages && page !== currentPage) {
            onPageChange(page);
        }
        setJumpValue('');
    };

    const handleJumpKeyDown = (e) => {
        if (e.key === 'Enter') commitJump();
        if (e.key === 'Escape') setJumpValue('');
    };

    return (
        <div className="shared-pagination">
            {/* First page */}
            <button
                className="shared-pagi-btn shared-pagi-icon-btn"
                onClick={() => onPageChange(1)}
                disabled={currentPage === 1}
                title="First Page"
            >
                <ChevronsLeft size={15} />
            </button>

            {/* Previous */}
            <button
                className="shared-pagi-btn"
                onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                title="Previous Page"
            >
                <ChevronLeft size={15} />
                <span>Previous</span>
            </button>

            {/* Centre info + jump input */}
            <div className="shared-pagi-centre">
                <span className="shared-pagi-info">
                    Page {currentPage} of {totalPages}
                    {totalCount != null && (
                        <span className="shared-pagi-count"> · {totalCount.toLocaleString()} {itemLabel}</span>
                    )}
                </span>

                {shouldShowJump && (
                    <div className="shared-pagi-jump">
                        <label className="shared-pagi-jump-label">Go to</label>
                        <input
                            className="shared-pagi-jump-input"
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            placeholder="pg"
                            value={jumpValue}
                            onChange={handleJumpChange}
                            onKeyDown={handleJumpKeyDown}
                            onBlur={commitJump}
                            aria-label="Go to page"
                            title={`Enter a page number between 1 and ${totalPages}`}
                        />
                        <button
                            className="shared-pagi-jump-btn"
                            onClick={commitJump}
                            disabled={!jumpValue}
                            title="Go to page"
                        >
                            Go
                        </button>
                    </div>
                )}
            </div>

            {/* Next */}
            <button
                className="shared-pagi-btn"
                onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                title="Next Page"
            >
                <span>Next</span>
                <ChevronRight size={15} />
            </button>

            {/* Last page */}
            <button
                className="shared-pagi-btn shared-pagi-icon-btn"
                onClick={() => onPageChange(totalPages)}
                disabled={currentPage === totalPages}
                title="Last Page"
            >
                <ChevronsRight size={15} />
            </button>
        </div>
    );
};

export default Pagination;
