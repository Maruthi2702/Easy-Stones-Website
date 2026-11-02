import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import LocationFilter from '../../../components/shared/LocationFilter';
import Pagination from '../../../components/shared/Pagination';
import RowMenu from '../../../components/shared/RowMenu';
import useIsPhone from '../../../components/shared/form/useIsPhone';
import { FormPicker, SegmentedToggle } from '../../../components/shared/form/FormControls';
import { useMyTeam } from '../../../api/myTeam';
import { canModifyVisit } from '../../../utils/visitAccess';
import { ALL_LOCATIONS } from '../../../utils/locationFilter';
import {
    DEFAULT_FOLLOW_UP_FILTERS, DUE_BUCKETS, FOLLOW_UP_STATUSES, followUpExportRows, followUpNote, followUpTags, pageOfGroups
} from '../../../utils/followUpList';
import type { DueBucket, FollowUpFilters, FollowUpRangeQuery, FollowUpRow, FollowUpStatus } from '../../../utils/followUpList';
import PeopleField from '../components/PeopleField';
import DashboardSearch from '../../../components/shared/DashboardSearch';
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
    /** The dashboard's time range (its header): read by due date (Today = today and later). */
    range: FollowUpRangeQuery;
    /** Status / Due: the dashboard holds them, so the Follow-up tile counts what's listed. */
    filters: FollowUpFilters;
    onFiltersChange: (next: FollowUpFilters) => void;
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
    /** The dashboard header's slot: this tab's Filters and ⋯ go there (one header for every tab). */
    toolSlot: HTMLElement | null;
    /** The header's All time / Custom part of Filters, and whether one is on. */
    rangeGroup: React.ReactNode;
    rangeActive?: boolean;
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
 * Done and pending together, each ticked done in one click (Undo, or add what happened, from the bar after). Filters (People,
 * Status, Due, Location) and ⋯ sit in the dashboard's header like every tab's, and
 * the rows are the "One header" design (claude.ai artifact "Dashboard tabs —
 * Visits, Resources, Follow-ups, Calendar", 2026-10-31). The dashboard's time
 * range picks the list by due date, done and pending together (owner, 2026-11-01:
 * no totals tiles; Today = due today and later, 30 days = due in the last 30).
 */
export default function FollowUpsPanel(p: FollowUpsPanelProps) {
    const viewerName = String(p.currentUser?.displayName || p.currentUser?.username || 'You');
    const fu = useFollowUps({ scope: p.scope, range: p.range, filters: p.filters, onFiltersChange: p.onFiltersChange, refreshKey: p.refreshKey, onPageChange: p.onPageChange, onChanged: p.onChanged, viewerName });
    const { filters, today, summary } = fu;
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
    const filtersOn = tags.length > 0 || locationOn || Boolean(p.people?.active) || Boolean(p.rangeActive);
    const paged = pageOfGroups(fu.groups, p.page, p.rowsPerPage);

    const set = (next: Partial<typeof filters>) => fu.setFilters({ ...filters, ...next });
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

    // Every follow-up in the range, whatever the Status / Due / search.
    const exportAll = async () => {
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(followUpExportRows(fu.rows, today)), 'Follow-ups');
        XLSX.writeFile(wb, 'Follow_ups_all.xlsx');
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
            {/* Title on the left, the dashboard's search box on the right (every tab). */}
            <div className="section-header fu-head dfx-tab-head">
                <h2>Follow-ups</h2>
                <DashboardSearch
                    value={fu.search}
                    onChange={fu.setSearch}
                    label="Search follow-ups"
                    count={fu.search ? `${fu.visible.length} of ${Math.max(fu.unsearchedCount, fu.visible.length)}` : null}
                />
            </div>

            {/* Filters and ⋯ live in the dashboard's header, the same place on every tab;
                what's on shows only inside Filters (owner, 2026-10-31). */}
            {p.toolSlot && createPortal(
                <>
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
                            {p.rangeGroup}
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
                        items={[
                            { key: 'export', label: `Export this view to Excel (${fu.visible.length})`, icon: Download, onClick: exportView },
                            { key: 'export-all', label: 'Export all follow-ups in this range', icon: Download, onClick: exportAll }
                        ]}
                    />
                </>,
                p.toolSlot
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
