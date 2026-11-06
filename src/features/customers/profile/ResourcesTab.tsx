import { Folder } from 'lucide-react';
import { useMyTeam } from '../../../api/myTeam';
import Pagination from '../../../components/shared/Pagination';
import { usePagination, pageCount } from '../../../components/shared/paginationConfig';
import useIsPhone from '../../../components/shared/form/useIsPhone';
import { formatForDateInput } from '../../../utils/dateUtils';
import { ResourceCards, ResourceTable, resourceDay } from '../../dashboard/resources';
import type { ResourceRowActions } from '../../dashboard/resources';
import { TabEmpty } from './TabStates';
import type { Loose } from '../../../types/records';

export type ResourcesTabProps = {
    resources: Loose[];
    currentUser: Loose | null;
    currentUserId: string | null;
    /** The resource being opened (its row waits). */
    loadingResourceId: string | null;
    canAddVisits: boolean;
    onAddResource: () => void;
    onViewResource: (resource: Loose) => void;
    onEditResource: (resource: Loose) => void;
    onDeleteResource: (resourceId: string, customerId?: string | null) => void;
};

/** Newest first, like Dashboard → Resources. */
const newestFirst = (rows: Loose[]) => [...rows].sort((a, b) =>
    resourceDay(b).localeCompare(resourceDay(a)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

/**
 * Customer profile → Resources: the customer's resources in Dashboard →
 * Resources' rows (owner, 2026-11-06: both look the same) — a table on desktop
 * and tablet, cards by week on a phone — without the Customer column, since
 * every row is this customer. A row opens the resource (its files, notes and
 * status); View / Edit / Delete are in its ⋯. 50 to a page. The Add resource
 * button is the header's (2026-10-29); the empty tab holds its own.
 */
export default function ResourcesTab({
    resources, currentUser, currentUserId, loadingResourceId, canAddVisits, onAddResource, onViewResource,
    onEditResource, onDeleteResource
}: ResourcesTabProps) {
    const team = useMyTeam(currentUser, currentUserId);
    const isPhone = useIsPhone();
    const paging = usePagination();
    if (resources.length === 0) {
        return (
            <div className="tab-section resources-tab">
                <TabEmpty
                    icon={<Folder size={28} aria-hidden="true" />}
                    title="No resources yet"
                    text="Add plans, quotes and files for this customer."
                    actionLabel={canAddVisits ? 'Add resource' : undefined}
                    onAction={onAddResource}
                />
            </div>
        );
    }
    const totalPages = pageCount(resources.length, paging.rowsPerPage);
    const page = Math.min(paging.currentPage, totalPages);
    const first = (page - 1) * paging.rowsPerPage;
    const shown = newestFirst(resources).slice(first, first + paging.rowsPerPage);
    const today = formatForDateInput(new Date());
    const actions: ResourceRowActions = {
        currentUser, currentUserId, team, loadingResourceId, onViewResource, onEditResource, onDeleteResource
    };
    return (
        <div className="tab-section resources-tab rs-panel">
            {isPhone
                ? <ResourceCards rows={shown} today={today} showCustomer={false} {...actions} />
                : <ResourceTable rows={shown} today={today} showCustomer={false} {...actions} />}

            {resources.length > paging.rowsPerPage && (
                <Pagination
                    currentPage={page} totalPages={totalPages} onPageChange={paging.setCurrentPage}
                    rowsPerPage={paging.rowsPerPage} onRowsPerPageChange={paging.setRowsPerPage} totalCount={resources.length}
                />
            )}
        </div>
    );
}
