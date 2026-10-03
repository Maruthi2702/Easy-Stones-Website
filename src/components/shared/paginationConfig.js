import { useState, useCallback } from 'react';

/**
 * Single source of truth for every paginated list in the app.
 *
 * Every list renders `<Pagination>` from ./Pagination.jsx and gets its page
 * state from `usePagination()` (or, when the page lives somewhere else such
 * as the URL, starts at DEFAULT_ROWS_PER_PAGE and resets to page 1 whenever
 * the rows-per-page changes). Don't hand-roll a pager or pass custom size
 * options — a new list should look and behave exactly like the existing ones.
 *
 * (Named paginationConfig.js, not pagination.js: on Windows' case-insensitive
 * filesystem Vite resolves `.js` before `.jsx`, so a `pagination.js` would
 * shadow every `import Pagination from '../shared/Pagination'`.)
 */
export const ROWS_PER_PAGE_OPTIONS = [25, 50, 100];
export const DEFAULT_ROWS_PER_PAGE = 50;

/** Number of pages for `totalCount` rows — never less than 1. */
export const pageCount = (totalCount, rowsPerPage) =>
    Math.max(1, Math.ceil((Number(totalCount) || 0) / rowsPerPage));

/** 1-indexed { from, to } of the rows shown on `page`; { 0, 0 } when empty. */
export const getPageRange = (page, rowsPerPage, totalCount) => {
    const total = Number(totalCount) || 0;
    if (total <= 0) return { from: 0, to: 0 };
    const from = Math.min((page - 1) * rowsPerPage + 1, total);
    return { from, to: Math.min(page * rowsPerPage, total) };
};

/**
 * Page numbers to show as buttons: first, last, and the current page ±1,
 * sorted and de-duplicated. The pager draws "…" wherever two neighbours
 * aren't consecutive, e.g. page 6 of 13 → [1, 5, 6, 7, 13] → 1 … 5 6 7 … 13.
 */
export const getPageButtons = (page, totalPages) => {
    const out = [];
    [1, page - 1, page, page + 1, totalPages].forEach((p) => {
        if (p >= 1 && p <= totalPages && !out.includes(p)) out.push(p);
    });
    return out.sort((a, b) => a - b);
};

/**
 * Page + rows-per-page state with the app's standard flow: starts at
 * DEFAULT_ROWS_PER_PAGE, and changing rows-per-page jumps back to page 1.
 * Call `resetPage()` whenever a search/filter/sort changes the result set.
 */
export function usePagination({ initialPage = 1 } = {}) {
    const [currentPage, setCurrentPage] = useState(initialPage);
    const [rowsPerPage, setRowsPerPageState] = useState(DEFAULT_ROWS_PER_PAGE);

    const setRowsPerPage = useCallback((n) => {
        setRowsPerPageState(n);
        setCurrentPage(1);
    }, []);
    const resetPage = useCallback(() => setCurrentPage(1), []);

    return { currentPage, setCurrentPage, rowsPerPage, setRowsPerPage, resetPage };
}
