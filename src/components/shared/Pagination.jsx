import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ROWS_PER_PAGE_OPTIONS, getPageRange, getPageButtons } from './paginationConfig';
import './Pagination.css';

/**
 * Reusable Pagination — the ONLY pager in the app. Every paginated list uses
 * this plus `usePagination()` from ./paginationConfig (rows per page is always
 * 25 / 50 / 100, default 50). Don't build a one-off pager for a new screen.
 *
 * Layout (from the Customer List design):
 *   Showing 1–50 of 312   [children]        ‹ 1 … 4 5 6 … 13 ›   Rows [50]
 *
 * Props:
 *   currentPage         {number}   – current active page (1-indexed)
 *   totalPages          {number}   – total number of pages
 *   onPageChange        {function} – called with new page number
 *   rowsPerPage         {number}   – current rows per page limit
 *   onRowsPerPageChange {function} – callback to change limit (should also go back to page 1)
 *   totalCount          {number}   – total rows across all pages; shows "Showing 1–50 of 312"
 *   children            {node}     – optional extra content shown after the "Showing" text
 */
const Pagination = ({
    currentPage,
    totalPages,
    onPageChange,
    rowsPerPage,
    onRowsPerPageChange,
    totalCount,
    children,
}) => {
    if (!totalPages || totalPages < 1) return null;

    const goTo = (page) => {
        const p = Math.max(1, Math.min(totalPages, page));
        if (p !== currentPage) onPageChange(p);
    };

    const hasRowsSelect = !!onRowsPerPageChange && rowsPerPage !== undefined;
    const hasRange = totalCount !== undefined && totalCount !== null && !!rowsPerPage;
    const range = hasRange ? getPageRange(currentPage, rowsPerPage, totalCount) : null;
    const pages = getPageButtons(currentPage, totalPages);

    return (
        <nav className="spag-root" aria-label="Pages">
            {hasRange && (
                <span className="spag-range" aria-live="polite">
                    Showing <b>{range.from.toLocaleString()}–{range.to.toLocaleString()}</b> of {Number(totalCount).toLocaleString()}
                </span>
            )}
            {children}
            <span className="spag-grow" />

            <div className="spag-pages">
                <button
                    type="button"
                    className="spag-pb"
                    aria-label="Previous page"
                    disabled={currentPage <= 1}
                    onClick={() => goTo(currentPage - 1)}
                >
                    <ChevronLeft size={16} />
                </button>
                {pages.map((p, i) => (
                    <React.Fragment key={p}>
                        {i > 0 && p - pages[i - 1] > 1 && <span className="spag-pb spag-gap" aria-hidden="true">…</span>}
                        <button
                            type="button"
                            className="spag-pb"
                            aria-label={`Page ${p}`}
                            aria-current={p === currentPage ? 'page' : undefined}
                            onClick={() => goTo(p)}
                        >
                            {p}
                        </button>
                    </React.Fragment>
                ))}
                <button
                    type="button"
                    className="spag-pb"
                    aria-label="Next page"
                    disabled={currentPage >= totalPages}
                    onClick={() => goTo(currentPage + 1)}
                >
                    <ChevronRight size={16} />
                </button>
            </div>

            {hasRowsSelect && (
                <label className="spag-rows">
                    Rows
                    <select
                        className="spag-rows-select"
                        value={rowsPerPage}
                        onChange={(e) => onRowsPerPageChange(Number(e.target.value))}
                        aria-label="Rows per page"
                    >
                        {ROWS_PER_PAGE_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                        ))}
                    </select>
                </label>
            )}
        </nav>
    );
};

export default Pagination;
