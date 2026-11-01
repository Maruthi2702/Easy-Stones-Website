import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { todayISO } from '../../../components/shared/calendar/calendarDates';
import {
    DEFAULT_FOLLOW_UP_FILTERS, groupFollowUps, searchFollowUps, shortDay, sortFollowUps, withDue, withStatus
} from '../../../utils/followUpList';
import type { FollowUpCounts, FollowUpFilters, FollowUpRangeQuery, FollowUpRow } from '../../../utils/followUpList';
import { changeFollowUp, fetchFollowUps } from './followUpsApi';

const NO_COUNTS: FollowUpCounts = { all: 0, done: 0, doneOnTime: 0, pending: 0, overdue: 0, today: 0, next7: 0, later: 0 };
const DONE_FIELDS = { followUpDoneAt: '', followUpDoneOn: '', followUpDoneBy: '', followUpDoneByName: '', followUpOutcome: '' };

/**
 * The last answer per query, kept across tab switches (the panel unmounts when
 * another tab opens). Remounting shows it at once and only re-reads when it's
 * older than FRESH_MS or the dashboard's `refreshKey` moved.
 */
const FRESH_MS = 30_000;
type Cached = { rows: FollowUpRow[]; counts: FollowUpCounts; summary: FollowUpCounts; at: number; refreshKey: number };
const cache = new Map<string, Cached>();
/** Forget every kept answer (tests, sign-out). */
export const clearFollowUpCache = () => cache.clear();

export type FollowUpNotice = { id: number; text: string; kind: 'ok' | 'error' };
/** The bar after a tick: Undo, or add what happened. */
export type FollowUpUndo = { id: number; row: FollowUpRow };

/**
 * Dashboard → Follow-ups' data: the page's own filters (Status, Due) and
 * search, the list for the dashboard's time range (by due date, plus every one
 * still overdue — `range`) and its People / location (`scope`), and the tick /
 * undo / reopen / snooze / note
 * actions. A change shows at once and the server's answer replaces it; a
 * refusal puts the row back and says why. After each change the list is read
 * again quietly so the totals catch up. `refreshKey` changes when the
 * dashboard reloads (a visit saved elsewhere).
 */
export function useFollowUps({ scope, range: rangeQ, refreshKey, onPageChange, onChanged, viewerName }: {
    scope: string;
    range: FollowUpRangeQuery;
    refreshKey: number;
    /** Back to page 1 on a filter or search change. */
    onPageChange: (page: number) => void;
    /** After a saved tick / reopen / snooze / note, so the dashboard's tiles catch up. */
    onChanged?: () => void;
    viewerName: string;
}) {
    const today = todayISO();
    const [filters, setFiltersRaw] = useState<FollowUpFilters>(DEFAULT_FOLLOW_UP_FILTERS);
    const [search, setSearchRaw] = useState('');
    const queryKey = `${scope}|${filters.status}|${rangeQ.range}|${rangeQ.from}|${rangeQ.to}|${today}`;
    const seed = cache.get(queryKey);
    const [rows, setRows] = useState<FollowUpRow[]>(seed?.rows ?? []);
    const [counts, setCounts] = useState<FollowUpCounts>(seed?.counts ?? NO_COUNTS);
    const [summary, setSummary] = useState<FollowUpCounts>(seed?.summary ?? NO_COUNTS);
    const [loading, setLoading] = useState(!seed);
    const [loadError, setLoadError] = useState('');
    const [notice, setNotice] = useState<FollowUpNotice | null>(null);
    const [undo, setUndo] = useState<FollowUpUndo | null>(null);
    const reqRef = useRef(0);
    const refreshKeyRef = useRef(refreshKey);
    refreshKeyRef.current = refreshKey;
    // The rows as they stand, for putting one back after a refused change.
    const rowsRef = useRef<FollowUpRow[]>([]);
    useEffect(() => { rowsRef.current = rows; }, [rows]);

    const { status } = filters;
    const { range, from, to } = rangeQ;
    const load = useCallback(async ({ quiet = false } = {}) => {
        const id = ++reqRef.current;
        if (!quiet) setLoading(true);
        try {
            const answer = await fetchFollowUps(status, { range, from, to }, todayISO(), scope);
            if (id !== reqRef.current) return; // a later request is on its way
            const nextRows = Array.isArray(answer.rows) ? answer.rows : [];
            setRows(nextRows);
            setCounts(answer.counts || NO_COUNTS);
            setSummary(answer.summary || NO_COUNTS);
            cache.set(queryKey, { rows: nextRows, counts: answer.counts || NO_COUNTS, summary: answer.summary || NO_COUNTS, at: Date.now(), refreshKey: refreshKeyRef.current });
            setLoadError('');
        } catch (error) {
            if (id === reqRef.current) setLoadError((error as Error).message || 'Could not load follow-ups');
        } finally {
            if (id === reqRef.current) setLoading(false);
        }
    }, [status, range, from, to, scope, queryKey]);

    useEffect(() => {
        const hit = cache.get(queryKey);
        if (hit && hit.refreshKey === refreshKey && Date.now() - hit.at < FRESH_MS) {
            setRows(hit.rows); setCounts(hit.counts); setSummary(hit.summary); setLoading(false);
            return;
        }
        // Something is on screen already (cached or from before): refresh without the spinner.
        load({ quiet: !!hit });
    }, [load, refreshKey, queryKey]);
    // A new dashboard range starts the list on page 1 (skipping the first run).
    const rangeKey = `${range}|${from}|${to}`;
    const lastRangeKey = useRef(rangeKey);
    useEffect(() => {
        if (lastRangeKey.current === rangeKey) return;
        lastRangeKey.current = rangeKey;
        onPageChange(1);
    }, [rangeKey, onPageChange]);

    const setFilters = (next: FollowUpFilters) => { setFiltersRaw(next); onPageChange(1); };
    const setSearch = (value: string) => { setSearchRaw(value); onPageChange(1); };

    // What's on screen: the server's rows with this screen's changes, then Due and search.
    const visible = useMemo(() => {
        const shown = withStatus(rows, filters.status);
        return sortFollowUps(searchFollowUps(withDue(shown, filters.status === 'pending' ? filters.due : 'all', today), search), filters.status);
    }, [rows, filters.status, filters.due, search, today]);
    const groups = useMemo(() => groupFollowUps(visible, filters.status, today), [visible, filters.status, today]);
    // How many the filters leave before the search: the search box's "2 of 17".
    const unsearchedCount = useMemo(
        () => withDue(withStatus(rows, filters.status), filters.status === 'pending' ? filters.due : 'all', today).length,
        [rows, filters.status, filters.due, today]
    );

    const patchRow = (id: unknown, fields: Partial<FollowUpRow>) =>
        setRows((prev) => prev.map((r) => (r._id === id ? { ...r, ...fields } : r)));
    const say = (text: string, kind: 'ok' | 'error' = 'error') => setNotice({ id: Date.now(), text, kind });

    /** Shows `fields` on the row now, sends the change, and puts the row back if it's refused. */
    const change = async (row: FollowUpRow, fields: Partial<FollowUpRow>, body: Parameters<typeof changeFollowUp>[1]) => {
        const current = rowsRef.current.find((r) => r._id === row._id) || row;
        const before: Partial<FollowUpRow> = Object.fromEntries(Object.keys(fields).map((k) => [k, current[k] ?? '']));
        patchRow(row._id, fields);
        try {
            const saved = await changeFollowUp(row, body);
            if (saved) patchRow(row._id, saved);
            cache.clear();
            load({ quiet: true });
            onChanged?.();
            return true;
        } catch (error) {
            patchRow(row._id, before);
            say(`Couldn't change the follow-up for ${row.company || row.customerName || 'this customer'}: ${(error as Error).message}`);
            return false;
        }
    };

    const tick = async (row: FollowUpRow) => {
        const ok = await change(row, {
            followUpDoneAt: new Date().toISOString(), followUpDoneOn: today, followUpDoneByName: viewerName, followUpOutcome: ''
        }, { action: 'done', today });
        if (ok) setUndo({ id: Date.now(), row });
    };
    const reopen = (row: FollowUpRow) => change(row, DONE_FIELDS, { action: 'reopen', today });
    const undoTick = () => {
        if (!undo) return;
        reopen(undo.row);
        setUndo(null);
    };
    const snooze = async (row: FollowUpRow, until: string) => {
        const ok = await change(row, { ...DONE_FIELDS, followUpDate: until }, { action: 'snooze', today, until });
        if (ok) say(`Snoozed to ${shortDay(until, today)}`, 'ok');
        return ok;
    };
    const saveOutcome = (row: FollowUpRow, outcome: string) => change(row, { followUpOutcome: outcome }, { action: 'note', today, outcome });

    return {
        today, filters, setFilters, search, setSearch,
        rows, visible, unsearchedCount, groups, counts, summary, loading, loadError, reload: load,
        notice, dismissNotice: () => setNotice(null), undo, dismissUndo: () => setUndo(null),
        tick, reopen, undoTick, snooze, saveOutcome
    };
}

export type FollowUpsData = ReturnType<typeof useFollowUps>;
