import { describe, it, expect } from 'vitest';
import { ROWS_PER_PAGE_OPTIONS, DEFAULT_ROWS_PER_PAGE, pageCount, getPageRange, getPageButtons } from './paginationConfig';

describe('getPageButtons', () => {
    it('shows first, last and the current page ±1', () => {
        expect(getPageButtons(6, 13)).toEqual([1, 5, 6, 7, 13]);
    });

    it('collapses overlaps at the edges', () => {
        expect(getPageButtons(1, 13)).toEqual([1, 2, 13]);
        expect(getPageButtons(2, 13)).toEqual([1, 2, 3, 13]);
        expect(getPageButtons(13, 13)).toEqual([1, 12, 13]);
    });

    it('handles tiny page counts', () => {
        expect(getPageButtons(1, 1)).toEqual([1]);
        expect(getPageButtons(2, 3)).toEqual([1, 2, 3]);
    });
});

describe('pagination config', () => {
    it('offers exactly 25 / 50 / 100 and defaults to 50', () => {
        expect(ROWS_PER_PAGE_OPTIONS).toEqual([25, 50, 100]);
        expect(DEFAULT_ROWS_PER_PAGE).toBe(50);
        expect(ROWS_PER_PAGE_OPTIONS).toContain(DEFAULT_ROWS_PER_PAGE);
    });
});

describe('pageCount', () => {
    it('rounds up and never drops below 1', () => {
        expect(pageCount(0, 50)).toBe(1);
        expect(pageCount(undefined, 50)).toBe(1);
        expect(pageCount(50, 50)).toBe(1);
        expect(pageCount(51, 50)).toBe(2);
        expect(pageCount(312, 25)).toBe(13);
    });
});

describe('getPageRange', () => {
    it('gives the 1-indexed rows on a page, capped at the total', () => {
        expect(getPageRange(1, 50, 312)).toEqual({ from: 1, to: 50 });
        expect(getPageRange(7, 50, 312)).toEqual({ from: 301, to: 312 });
        expect(getPageRange(1, 100, 40)).toEqual({ from: 1, to: 40 });
    });

    it('is 0–0 for an empty list', () => {
        expect(getPageRange(1, 50, 0)).toEqual({ from: 0, to: 0 });
    });

    it('stays in range if the page is briefly past the end (e.g. after a filter)', () => {
        expect(getPageRange(9, 50, 120)).toEqual({ from: 120, to: 120 });
    });
});
