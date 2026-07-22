import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import './Pagination.css';

/**
 * Reusable Pagination — used site-wide.
 *
 * Layout:  ⟨⟨  ‹  Page [n] of T  ›  ⟩⟩ (with optional "Rows per page:" select)
 *
 * Props:
 *   currentPage        {number}    – current active page (1-indexed)
 *   totalPages         {number}    – total number of pages
 *   onPageChange       {function}  – called with new page number
 *   rowsPerPage        {number}    – current rows per page limit
 *   onRowsPerPageChange {function} – callback to change limit
 *   rowsPerPageOptions {number[]}  – custom options for rows per page selector
 *   totalCount         {number}    – unused (kept for back-compat)
 *   itemLabel          {string}    – unused (kept for back-compat)
 */
const Pagination = ({
    currentPage,
    totalPages,
    onPageChange,
    rowsPerPage,
    onRowsPerPageChange,
    rowsPerPageOptions = [15, 25, 50],
}) => {
    const [inputVal, setInputVal] = useState(String(currentPage));
    const inputRef = useRef(null);

    // Keep input in sync when page changes externally
    useEffect(() => {
        setInputVal(String(currentPage));
    }, [currentPage]);

    if (!totalPages || totalPages < 1) return null;

    const goTo = (page) => {
        const p = Math.max(1, Math.min(totalPages, page));
        if (p !== currentPage) onPageChange(p);
    };

    const handleInputChange = (e) => {
        const val = e.target.value;
        if (val === '' || /^\d+$/.test(val)) setInputVal(val);
    };

    const commitInput = () => {
        const parsed = parseInt(inputVal, 10);
        if (!isNaN(parsed)) {
            goTo(parsed);
        } else {
            setInputVal(String(currentPage)); // reset on bad input
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') { commitInput(); inputRef.current?.blur(); }
        if (e.key === 'Escape') { setInputVal(String(currentPage)); inputRef.current?.blur(); }
        if (e.key === 'ArrowUp')   { e.preventDefault(); goTo(currentPage + 1); }
        if (e.key === 'ArrowDown') { e.preventDefault(); goTo(currentPage - 1); }
    };

    const inputWidth = `${Math.max(1.8, String(totalPages).length * 0.65 + 0.8)}rem`;
    const hasRowsSelect = !!onRowsPerPageChange && rowsPerPage !== undefined;

    return (
        <div className={`spag-root ${hasRowsSelect ? 'has-rows-select' : ''}`}>
            {hasRowsSelect && (
                <div className="spag-rows-select-wrapper">
                    <span className="spag-rows-label">
                        <span className="spag-label-full">Rows per page:</span>
                        <span className="spag-label-short">Rows:</span>
                    </span>
                    <select
                        className="spag-rows-select"
                        value={rowsPerPage}
                        onChange={(e) => onRowsPerPageChange(Number(e.target.value))}
                        aria-label="Rows per page"
                    >
                        {rowsPerPageOptions.map((opt) => (
                            <option key={opt} value={opt}>
                                {opt}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            <div className="spag-controls-group">
                {/* Prev */}
                <button
                    className="spag-nav-btn"
                    onClick={() => goTo(currentPage - 1)}
                    disabled={currentPage === 1}
                    title="Previous page"
                    aria-label="Previous page"
                >
                    <ChevronLeft size={14} />
                </button>

                {/* Page pill */}
                <div className="spag-page-pill">
                    <span className="spag-page-label">Page</span>
                    <input
                        ref={inputRef}
                        className="spag-page-input"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={inputVal}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        onBlur={commitInput}
                        onFocus={(e) => e.target.select()}
                        style={{ width: inputWidth }}
                        aria-label={`Page ${currentPage} of ${totalPages}`}
                    />
                    <span className="spag-page-sep">of</span>
                    <span className="spag-page-total">{totalPages}</span>
                </div>

                {/* Next */}
                <button
                    className="spag-nav-btn"
                    onClick={() => goTo(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    title="Next page"
                    aria-label="Next page"
                >
                    <ChevronRight size={14} />
                </button>
            </div>
        </div>
    );
};

export default Pagination;
