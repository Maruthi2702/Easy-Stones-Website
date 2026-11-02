import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download } from 'lucide-react';
import LocationFilter from '../../../components/shared/LocationFilter';
import { useMyTeam } from '../../../api/myTeam';
import { useResourceFamilies, useResourceTypes } from '../../../api/typeLists';
import PeopleField from '../components/PeopleField';
import DashboardSearch from '../../../components/shared/DashboardSearch';
import type { PeopleFilter } from '../components/PeopleField';
import Pagination from '../../../components/shared/Pagination';
import RowMenu from '../../../components/shared/RowMenu';
import useIsPhone from '../../../components/shared/form/useIsPhone';
import { ALL_LOCATIONS } from '../../../utils/locationFilter';
import { formatForDateInput } from '../../../utils/dateUtils';
import type { Loose } from '../../../types/records';
import { ResourceCards, ResourceTable } from './ResourceRows';
import type { ResourceRowActions } from './ResourceRows';
import {
    NO_RESOURCE_FILTERS, activeFilterCount, typeInfoFrom, applyResourceFilters, loggerFacets, typeFacets
} from './resourceList';
import type { ResourceFilters } from './resourceList';
import './ResourcesPanel.css';

export type ResourcesPanelProps = Omit<ResourceRowActions, 'team'> & {
    /** The period's resources that match the search, newest first. */
    rows: Loose[];
    tableLoading: boolean;
    page: number;
    rowsPerPage: number;
    onPageChange: (page: number) => void;
    onRowsPerPageChange: (rows: number) => void;
    searchTerm: string;
    onSearchChange: (value: string) => void;
    locationOptions: string[];
    location: string;
    onLocationChange: (value: string) => void;
    /** The People filter (dashboardPeople.ts); null when they only see their own. */
    people: PeopleFilter | null;
    /** The dashboard header's slot: this tab's Filters and ⋯ go there (one header for every tab). */
    toolSlot: HTMLElement | null;
    /** The header's All time / Custom part of Filters, and whether one is on. */
    rangeGroup: React.ReactNode;
    rangeActive?: boolean;
    /** Resources in the period before the search (the tile's number), for "2 of 17". */
    periodCount?: number;
    /** Excel of what's on screen (filters and search applied). */
    onExportView: (rows: Loose[]) => void;
    /** Excel of every resource the login can see, all dates. */
    onExportAll: () => void;
};

/**
 * Dashboard → Resources: the resources placed at customers (Option A on the
 * claude.ai artifact Resources Redesign Canvas,
 * https://claude.ai/artifact/TSMaMjGbsD5o1WDD7CYUiu). Search, the shared
 * Filters panel (resource types by family, who logged it, location) with what's
 * ticked shown as removable tags, and ⋯ with the two Excel exports. A table on
 * desktop and tablet, cards grouped by week on a phone; a row opens the
 * resource. Team Files is its own Sales page now (src/features/teamFiles/).
 */
export default function ResourcesPanel(p: ResourcesPanelProps) {
    const team = useMyTeam(p.currentUser, p.currentUserId);
    const { rows, page, rowsPerPage, onPageChange } = p;
    const isPhone = useIsPhone();
    const [filters, setFilters] = useState<ResourceFilters>(NO_RESOURCE_FILTERS);
    const today = formatForDateInput(new Date());

    const resourceTypes = useResourceTypes();
    const families = useResourceFamilies().types;
    const info = useMemo(() => typeInfoFrom(resourceTypes.types, families), [resourceTypes.types, families]);
    const types = useMemo(() => typeFacets(rows, info, families), [rows, info, families]);
    const loggers = useMemo(() => loggerFacets(rows), [rows]);
    const filtered = useMemo(() => applyResourceFilters(rows, filters), [rows, filters]);
    const paged = filtered.slice((page - 1) * rowsPerPage, page * rowsPerPage);
    const ticked = activeFilterCount(filters);
    const locationOn = Boolean(p.location) && p.location !== ALL_LOCATIONS;

    const update = (next: ResourceFilters) => { setFilters(next); onPageChange(1); };
    const toggle = (group: keyof ResourceFilters, value: string) => update({
        ...filters,
        [group]: filters[group].includes(value) ? filters[group].filter((v) => v !== value) : [...filters[group], value]
    });
    const clearAll = () => {
        update(NO_RESOURCE_FILTERS);
        if (locationOn) p.onLocationChange(ALL_LOCATIONS);
        p.onSearchChange('');
    };

    const empty = (() => {
        if (filtered.length > 0) return null;
        if (p.tableLoading && rows.length === 0) return <div className="rs-empty" role="status">Loading…</div>;
        if (rows.length === 0 && !p.searchTerm) return <div className="rs-empty">No resources for this period.</div>;
        return (
            <div className="rs-empty">
                <strong>No resources match</strong>
                <span>{p.searchTerm ? `Nothing for “${p.searchTerm}” with these filters.` : 'Nothing with these filters.'}</span>
                <button type="button" className="rs-clear-btn" onClick={clearAll}>Clear search and filters</button>
            </div>
        );
    })();

    const actions: ResourceRowActions = {
        currentUser: p.currentUser,
        currentUserId: p.currentUserId,
        team,
        loadingResourceId: p.loadingResourceId,
        onViewResource: p.onViewResource,
        onEditResource: p.onEditResource,
        onDeleteResource: p.onDeleteResource
    };

    return (
        <div className="visits-table-section rs-panel">
            {/* Title on the left, the dashboard's search box on the right (every tab). */}
            <div className="section-header rs-head dfx-tab-head">
                <h2>Resources</h2>
                <DashboardSearch
                    value={p.searchTerm}
                    onChange={p.onSearchChange}
                    label="Search resources"
                    count={p.searchTerm ? `${filtered.length} of ${Math.max(p.periodCount ?? rows.length, filtered.length)}` : null}
                />
            </div>

            {/* Filters and ⋯ live in the dashboard's header, the same place on every tab;
                what's ticked shows only inside Filters (owner, 2026-10-31). */}
            {p.toolSlot && createPortal(
                <>
                    <LocationFilter
                        options={p.locationOptions}
                        value={p.location}
                        onChange={p.onLocationChange}
                        user={p.currentUser}
                        active={ticked > 0 || locationOn || Boolean(p.people?.active) || Boolean(p.rangeActive)}
                        onClear={() => { update(NO_RESOURCE_FILTERS); p.people?.onReset(); }}
                        wide
                    >
                        <>
                            {p.rangeGroup}
                            {p.people && <PeopleField {...p.people} />}
                            {types.length > 0 && (
                                <div className="lf-group" role="group" aria-labelledby="rs-f-types">
                                    <span className="lf-group-label" id="rs-f-types">Resource type</span>
                                    {types.map((family) => (
                                        <div key={family.family} className="rs-fgroup">
                                            <span className="rs-fgroup-label">{family.label}</span>
                                            <div className="lf-checks">
                                                {family.types.map(({ type, label, count }) => (
                                                    <label key={type} className="lf-check">
                                                        <input type="checkbox" checked={filters.types.includes(type)} onChange={() => toggle('types', type)} />
                                                        <span className="rs-check-text">{label}</span>
                                                        <span className="rs-count">{count}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {/* The People field above replaces it for anyone who has one. */}
                            {!p.people && loggers.length > 1 && (
                                <div className="lf-group" role="group" aria-labelledby="rs-f-by">
                                    <span className="lf-group-label" id="rs-f-by">Logged by</span>
                                    <div className="lf-checks">
                                        {loggers.map(({ name, count }) => (
                                            <label key={name} className="lf-check">
                                                <input type="checkbox" checked={filters.loggedBy.includes(name)} onChange={() => toggle('loggedBy', name)} />
                                                <span className="rs-check-text">{name}</span>
                                                <span className="rs-count">{count}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    </LocationFilter>
                    <RowMenu
                        label="More"
                        items={[
                            { key: 'export-view', label: `Export this view to Excel (${filtered.length})`, icon: Download, onClick: () => p.onExportView(filtered) },
                            { key: 'export-all', label: 'Export all resources to Excel', icon: Download, onClick: p.onExportAll }
                        ]}
                    />
                </>,
                p.toolSlot
            )}

            {empty || (isPhone
                ? <ResourceCards rows={paged} today={today} {...actions} />
                : <ResourceTable rows={paged} today={today} {...actions} />)}

            <Pagination
                currentPage={page}
                totalPages={Math.ceil(filtered.length / rowsPerPage)}
                onPageChange={(n) => { onPageChange(n); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={p.onRowsPerPageChange}
                totalCount={filtered.length}
            />
        </div>
    );
}
