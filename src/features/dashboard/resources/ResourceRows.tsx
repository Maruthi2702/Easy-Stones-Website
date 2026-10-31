import { Eye, Loader, Pencil, Trash2 } from 'lucide-react';
import RowMenu from '../../../components/shared/RowMenu';
import type { RowMenuItem } from '../../../components/shared/RowMenu';
import { canDeleteVisit, canModifyVisit } from '../../../utils/visitAccess';
import { resourceQty } from '../../../utils/resourceForm';
import type { Loose } from '../../../types/records';
import {
    FAMILY_TAGS, customerParts, familyOf, groupByWeek, loggedByOf, resourceDay, shortDay, typeOf
} from './resourceList';

export type ResourceRowActions = {
    currentUser: Loose | null;
    currentUserId: string | null;
    /** Who is on the viewer's team, for the "branch" switches (useMyTeam). */
    team: '*' | Set<string>;
    /** The resource being opened (its row waits). */
    loadingResourceId: string | null;
    onViewResource: (resource: Loose) => void;
    onEditResource: (resource: Loose) => void;
    onDeleteResource: (resourceId: string, customerId?: string | null) => void;
};

type RowsProps = ResourceRowActions & { rows: Loose[]; today: string };

// A resource follows the visit rules, its uploader standing in for who logged
// the visit (resourceAccessArgs in server.js, which checks it again).
const accessArgs = (a: ResourceRowActions, r: Loose) => [
    { ...a.currentUser, id: a.currentUserId },
    { createdBy: r.uploadedBy || r.createdBy },
    a.team
] as const;

const rowMenuItems = (a: ResourceRowActions, r: Loose): RowMenuItem[] => {
    const items: RowMenuItem[] = [{ key: 'view', label: 'View', icon: Eye, onClick: () => a.onViewResource(r) }];
    if (canModifyVisit(...accessArgs(a, r))) items.push({ key: 'edit', label: 'Edit', icon: Pencil, onClick: () => a.onEditResource(r) });
    if (canDeleteVisit(...accessArgs(a, r))) {
        items.push({ key: 'delete', label: 'Delete', icon: Trash2, danger: true, divider: true, onClick: () => a.onDeleteResource(r._id, r.customerId) });
    }
    return items;
};

const TypeChip = ({ type }: { type: string }) => (
    <span className={`rs-type rs-type--${familyOf(type)}`}><i aria-hidden="true" />{type || '—'}</span>
);

/** Desktop and tablet: one row per resource; a click (or Enter) opens it. */
export function ResourceTable({ rows, today, ...a }: RowsProps) {
    return (
        <div className="dashboard-table-wrapper">
            <table className="dashboard-table rs-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Customer</th>
                        <th>Resource</th>
                        <th className="rs-num">Qty</th>
                        <th className="rs-col-note">Note</th>
                        <th className="rs-col-by">Logged by</th>
                        <th><span className="rs-sr">Actions</span></th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => {
                        const { company, contact } = customerParts(r);
                        const note = r.description || r.notes || '';
                        const sub = [contact, r.city].filter(Boolean).join(' · ');
                        const busy = a.loadingResourceId === r._id;
                        return (
                            <tr
                                key={r._id}
                                className="rs-row"
                                tabIndex={0}
                                aria-label={`Open ${typeOf(r)} at ${company}`}
                                onClick={() => !busy && a.onViewResource(r)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget && !busy) a.onViewResource(r); }}
                            >
                                <td className="rs-date">{shortDay(resourceDay(r), today)}</td>
                                <td className="rs-cust">
                                    <strong>{company || '—'}</strong>
                                    {sub && <span className="rs-sub">{sub}</span>}
                                    {note && <span className="rs-note-inline">{note}</span>}
                                </td>
                                <td><TypeChip type={typeOf(r)} /></td>
                                <td className="rs-num">{resourceQty(r)}</td>
                                <td className="rs-col-note rs-note">{note || '—'}</td>
                                <td className="rs-col-by rs-by">{loggedByOf(r)}</td>
                                <td className="rs-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                                    {busy
                                        ? <Loader size={16} className="animate-spin" aria-label="Opening" />
                                        : <RowMenu label="Resource actions" items={rowMenuItems(a, r)} />}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

/** Phones: cards under week headings; the whole card opens the resource (Edit / Delete are inside it). */
export function ResourceCards({ rows, today, ...a }: RowsProps) {
    return (
        <div className="rs-cards">
            {groupByWeek(rows, today).map((group) => (
                <section key={group.heading} className="rs-week" aria-label={group.heading}>
                    <h3 className="rs-week-head"><span>{group.heading}</span><span>{group.rows.length}</span></h3>
                    {group.rows.map((r) => {
                        const { company } = customerParts(r);
                        const type = typeOf(r);
                        const family = familyOf(type);
                        const meta = [r.city, loggedByOf(r)].filter(Boolean).join(' · ');
                        const busy = a.loadingResourceId === r._id;
                        return (
                            <button key={r._id} type="button" className="rs-card" disabled={busy} onClick={() => a.onViewResource(r)}>
                                <span className={`rs-tile rs-type--${family}`} aria-hidden="true">{FAMILY_TAGS[family]}</span>
                                <span className="rs-card-text">
                                    <strong>{company || '—'}</strong>
                                    <span>{type || '—'}</span>
                                    {meta && <small>{meta}</small>}
                                </span>
                                <span className="rs-card-side">
                                    {busy ? <Loader size={14} className="animate-spin" aria-label="Opening" /> : shortDay(resourceDay(r), today)}
                                    <span className="rs-qty">×{resourceQty(r)}</span>
                                </span>
                            </button>
                        );
                    })}
                </section>
            ))}
        </div>
    );
}
