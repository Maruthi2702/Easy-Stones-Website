import { useEffect, useState } from 'react';
import { Download, Search, X } from 'lucide-react';
import LocationFilter from '../../../components/shared/LocationFilter';
import Pagination from '../../../components/shared/Pagination';
import RowMenu from '../../../components/shared/RowMenu';
import useIsPhone from '../../../components/shared/form/useIsPhone';
import { FormPicker, SegmentedToggle } from '../../../components/shared/form/FormControls';
import { useMyTeam } from '../../../api/myTeam';
import { canModifyVisit } from '../../../utils/visitAccess';
import { ALL_LOCATIONS } from '../../../utils/locationFilter';
import {
    DEFAULT_FOLLOW_UP_FILTERS, DUE_BUCKETS, FOLLOW_UP_STATUSES, followUpExportRows, followUpNote, followUpTags, pageOfGroups, rangeHasTotals, withoutTag
} from '../../../utils/followUpList';
import type { DueBucket, FollowUpRangeQuery, FollowUpRow, FollowUpStatus } from '../../../utils/followUpList';
import PeopleField from '../components/PeopleField';
import type { PeopleFilter } from '../components/PeopleField';
import type { Loose } from '../../../types/records';
import { FollowUpCards, FollowUpTable } from './FollowUpRows';
import type { FollowUpRowActions } from './FollowUpRows';
import { OutcomeDialog, SnoozeDialog } from './FollowUpDialogs';
import { useFollowUps } from './useFollowUps';
import '../../../components/shared/form/FormModal.css';
import './FollowUpsPanel.css';

export type FollowUpsPanelProps = {
    /** The dashboard's People / location query (`&reps=…&location=…`). */
    scope: string;
    /** The dashboard's time range (its header): read by due date, plus every one still overdue. */
    range: FollowUpRangeQuery;
    /** After a saved tick / reopen / snooze / note (the dashboard re-reads its tiles). */
    onChanged?: () => void;
    /** Changes when the dashboard reloads its lists (a visit saved elsewhere). */
    refreshKey: number;
    page: number;
    rowsPerPage: number;
    onPageChange: (page: number) => void;
    onRowsPerPageChange: (rows: number) => void;
    locationOptions: string[];
    location: string;
    onLocationChange: (value: string) => void;
    currentUser: Loose | null;
    currentUserId: string | null;
    /** The People filter (dashboardPeople.ts); null when they only see their own. */
    people: PeopleFilter | null;
    /** More than the viewer is in view: a Rep column says whose each one is. */
    showWhoLogged?: boolean;
    onViewVisit: (visit: Loose) => void;
    onEditVisit: (visit: Loose) => void;
    /** A customer's profile (also leaves the dashboard). */
    onOpenCustomer: (customerId: string) => void;
};

const UNDO_MS = 8000;

/**
 * Dashboard → Follow-ups (design A · Due list on the claude.ai artifact
 * "Follow-ups redesign canvas", https://claude.ai/artifact/5x7prJdkNJAKcViVbzeTbK).
 * Pending ones grouped Overdue / Today / Next 7 days / Later, each ticked done
 * in one click (Undo, or add what happened, from the bar after); the Filters
 * panel holds People, Status (Pending / Done / All), Due and Location, what's on
 * shown as tags. The dashboard's time range applies by due date, and anything
 * still overdue is always listed; a range looking back brings up its totals.
 */
export default function FollowUpsPanel(p: FollowUpsPanelProps) {
    const viewerName = String(p.currentUser?.displayName || p.currentUser?.username || 'You');
    const fu = useFollowUps({ scope: p.scope, range: p.range, refreshKey: p.refreshKey, onPageChange: p.onPageChange, onChanged: p.onChanged, viewerName });
    const { filters, today, counts, summary } = fu;
    const team = useMyTeam(p.currentUser, p.currentUserId);
    const isPhone = useIsPhone();
    const [snoozing, setSnoozing] = useState<FollowUpRow | null>(null);
    const [noting, setNoting] = useState<FollowUpRow | null>(null);

    // The Undo bar goes after a while; a new tick restarts it.
    const undoId = fu.undo?.id;
    const { dismissUndo } = fu;
    useEffect(() => {
        if (!undoId) return undefined;
        const t = setTimeout(dismissUndo, UNDO_MS);
        return () => clearTimeout(t);
    }, [undoId, dismissUndo]);
    const noticeId = fu.notice?.id;
    const noticeKind = fu.notice?.kind;
    const { dismissNotice } = fu;
    useEffect(() => {
        if (!noticeId) return undefined;
        const t = setTimeout(dismissNotice, noticeKind === 'error' ? 9000 : 4000);
        return () => clearTimeout(t);
    }, [noticeId, noticeKind, dismissNotice]);

    const tags = followUpTags(filters);
    const locationOn = Boolean(p.location) && p.location !== ALL_LOCATIONS;
    const filtersOn = tags.length > 0 || Boolean(p.people?.active);
    const paged = pageOfGroups(fu.groups, p.page, p.rowsPerPage);

    const set = (next: Partial<typeof filters>) => fu.setFilters({ ...filters, ...next });
    const showTiles = rangeHasTotals(p.range.range);
    // While a new range loads, the tiles say so rather than show the last range's numbers.
    const num = (n: number) => (fu.loading ? '…' : n);
    const clearAll = () => {
        fu.setFilters(DEFAULT_FOLLOW_UP_FILTERS);
        if (locationOn) p.onLocationChange(ALL_LOCATIONS);
        fu.setSearch('');
    };

    const actions: FollowUpRowActions = {
        today,
        status: filters.status,
        showWhoLogged: Boolean(p.showWhoLogged),
        canModify: (row) => canModifyVisit({ ...p.currentUser, id: p.currentUserId }, row, team),
        onTick: fu.tick,
        onReopen: fu.reopen,
        onSnooze: setSnoozing,
        onOutcome: setNoting,
        onViewVisit: p.onViewVisit,
        onEditVisit: p.onEditVisit,
        onOpenCustomer: p.onOpenCustomer
    };

    const exportView = async () => {
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(followUpExportRows(fu.visible, today)), 'Follow-ups');
        XLSX.writeFile(wb, 'Follow_ups.xlsx');
    };

    const empty = (() => {
        if (fu.visible.length > 0) return null;
        if (fu.loading && fu.rows.length === 0) return <div className="fu-empty" role="status">Loading…</div>;
        if (fu.loadError) {
            return (
                <div className="fu-empty" role="alert">
                    <strong>Couldn't load follow-ups</strong>
                    <span>{fu.loadError}</span>
                    <button type="button" className="fu-clear-btn" onClick={() => fu.reload()}>Try again</button>
                </div>
            );
        }
        if (fu.search || filtersOn || locationOn) {
            return (
                <div className="fu-empty">
                    <strong>No follow-ups match</strong>
                    <span>{fu.search ? `Nothing for “${fu.search}” with these filters.` : 'Nothing with these filters.'}</span>
                    <button type="button" className="fu-clear-btn" onClick={clearAll}>Clear search and filters</button>
                </div>
            );
        }
        return <div className="fu-empty"><strong>Nothing to follow up</strong><span>Follow-ups set on visits show here until they're done.</span></div>;
    })();

    return (
        <div className="visits-table-section fu-panel">
            <div className="section-header fu-head">
                <div className="fu-title">
                    <h2>Follow-ups</h2>
                    <p className="fu-summary">
                        {summary.pending} pending
                        {summary.overdue > 0 && <> · <span className="fu-late-text">{summary.overdue} overdue</span></>}
                        {' · '}
                        <button type="button" className="fu-done-link" onClick={() => set({ status: 'done', due: 'all' })}>
                            {summary.done} done
                        </button>
                    </p>
                </div>
                <div className="table-controls fu-controls">
                    <div className="table-search fu-search">
                        <Search className="search-icon" size={18} aria-hidden="true" />
                        <input
                            type="text"
                            className="no-capitalize"
                            placeholder="Search customer, note, rep"
                            aria-label="Search follow-ups"
                            value={fu.search}
                            onChange={(e) => fu.setSearch(e.target.value)}
                        />
                        {fu.search && (
                            <button type="button" className="table-search-clear" aria-label="Clear search" onClick={() => fu.setSearch('')}>
                                <X size={14} />
                            </button>
                        )}
                    </div>
                    <LocationFilter
                        options={p.locationOptions}
                        value={p.location}
                        onChange={p.onLocationChange}
                        user={p.currentUser}
                        active={filtersOn}
                        onClear={() => { fu.setFilters(DEFAULT_FOLLOW_UP_FILTERS); p.people?.onReset(); }}
                        wide
                    >
                        <div className="fm-tokens fu-fields">
                            {p.people && <PeopleField {...p.people} />}
                            <div className="lf-group" role="group" aria-labelledby="fu-f-status">
                                <span className="lf-group-label" id="fu-f-status">Status</span>
                                <SegmentedToggle<FollowUpStatus>
                                    label="Status"
                                    value={filters.status}
                                    onChange={(status) => set({ status, due: status === 'pending' ? filters.due : 'all' })}
                                    options={FOLLOW_UP_STATUSES}
                                />
                            </div>
                            {filters.status === 'pending' && (
                                <div className="lf-group">
                                    <label className="lf-group-label" htmlFor="fu-f-due">Due</label>
                                    <FormPicker<DueBucket>
                                        id="fu-f-due"
                                        value={filters.due}
                                        onChange={(due) => set({ due })}
                                        options={DUE_BUCKETS.map((b) => ({
                                            value: b.value,
                                            label: `${b.label} · ${b.value === 'all' ? summary.pending : summary[b.value]}`
                                        }))}
                                        sheetTitle="Due"
                                    />
                                </div>
                            )}
                        </div>
                    </LocationFilter>
                    <RowMenu
                        label="More"
                        items={[{ key: 'export', label: `Export this view to Excel (${fu.visible.length})`, icon: Download, onClick: exportView }]}
                    />
                </div>
            </div>

            {(tags.length > 0 || locationOn) && (
                <div className="rs-pills fu-pills" aria-label="Filters on">
                    {tags.map((t) => (
                        <span key={t.key} className="rs-pill">
                            {t.label}
                            <button type="button" aria-label={`Remove ${t.label}`} onClick={() => fu.setFilters(withoutTag(filters, t.key))}><X size={12} /></button>
                        </span>
                    ))}
                    {locationOn && (
                        <span className="rs-pill">
                            {p.location}
                            <button type="button" aria-label={`Remove ${p.location}`} onClick={() => p.onLocationChange(ALL_LOCATIONS)}><X size={12} /></button>
                        </span>
                    )}
                    <button type="button" className="rs-clear-link" onClick={clearAll}>Clear all</button>
                </div>
            )}

            {showTiles && (
                <div className="fu-tiles" role="group" aria-label="Show">
                    <button type="button" className="fu-tile" aria-pressed={filters.status === 'all'} onClick={() => set({ status: 'all', due: 'all' })}>
                        <span className="fu-tile-label">All follow-ups</span>
                        <span className="fu-tile-num">{num(counts.all)}</span>
                        <span className="fu-tile-sub">due in this range</span>
                    </button>
                    <button type="button" className="fu-tile" aria-pressed={filters.status === 'done'} onClick={() => set({ status: 'done', due: 'all' })}>
                        <span className="fu-tile-label">Done</span>
                        <span className="fu-tile-num is-ok">{num(counts.done)}</span>
                        <span className="fu-tile-sub">
                            {fu.loading ? '…' : `${counts.all ? Math.round((counts.done / counts.all) * 100) : 0}% · ${counts.doneOnTime} on time`}
                        </span>
                    </button>
                    <button type="button" className="fu-tile" aria-pressed={filters.status === 'pending' && filters.due === 'all'} onClick={() => set({ status: 'pending', due: 'all' })}>
                        <span className="fu-tile-label">Pending</span>
                        <span className="fu-tile-num">{num(counts.pending)}</span>
                        <span className="fu-tile-sub">not done yet</span>
                    </button>
                    <button type="button" className="fu-tile" aria-pressed={filters.status === 'pending' && filters.due === 'overdue'} onClick={() => set({ status: 'pending', due: 'overdue' })}>
                        <span className="fu-tile-label">Overdue</span>
                        <span className="fu-tile-num is-late">{num(counts.overdue)}</span>
                        <span className="fu-tile-sub">pending and past due</span>
                    </button>
                </div>
            )}

            {empty || (isPhone ? <FollowUpCards groups={paged} {...actions} /> : <FollowUpTable groups={paged} {...actions} />)}

            <Pagination
                currentPage={p.page}
                totalPages={Math.ceil(fu.visible.length / p.rowsPerPage)}
                onPageChange={(n) => { p.onPageChange(n); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                rowsPerPage={p.rowsPerPage}
                onRowsPerPageChange={p.onRowsPerPageChange}
                totalCount={fu.visible.length}
            />

            {fu.undo ? (
                <div className="fu-bar" role="status">
                    <span className="fu-bar-text"><strong>Done:</strong> {fu.undo.row.company || fu.undo.row.customerName}{followUpNote(fu.undo.row) ? ` · ${followUpNote(fu.undo.row)}` : ''}</span>
                    <button type="button" className="fu-bar-btn is-quiet" onClick={() => { setNoting(fu.undo!.row); fu.dismissUndo(); }}>What happened?</button>
                    <button type="button" className="fu-bar-btn" onClick={fu.undoTick}>Undo</button>
                    <button type="button" className="fu-bar-x" aria-label="Dismiss" onClick={fu.dismissUndo}><X size={16} /></button>
                </div>
            ) : fu.notice && (
                <div className={`fu-bar${fu.notice.kind === 'error' ? ' is-error' : ''}`} role={fu.notice.kind === 'error' ? 'alert' : 'status'}>
                    <span className="fu-bar-text">{fu.notice.text}</span>
                    <button type="button" className="fu-bar-x" aria-label="Dismiss" onClick={fu.dismissNotice}><X size={16} /></button>
                </div>
            )}

            {snoozing && <SnoozeDialog row={snoozing} today={today} onSnooze={(until) => fu.snooze(snoozing, until)} onClose={() => setSnoozing(null)} />}
            {noting && <OutcomeDialog row={noting} onSave={(outcome) => fu.saveOutcome(noting, outcome)} onClose={() => setNoting(null)} />}
        </div>
    );
}
