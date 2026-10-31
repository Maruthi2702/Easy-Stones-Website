import { useState } from 'react';
import { Edit2, Trash2, Check, AlertTriangle, Ellipsis } from 'lucide-react';
import type { PlannerItem } from '../plannerSchedule';
import type { StopMove } from '../useMoveStop';
import { activityModifier, activityColor, customerName, lengthOf, timeLabel, timeParts, visitFlag } from '../salesPlanner';
import type { Loose } from '../../../types/records';

export type CardActions = {
    move: StopMove;
    onSelectCustomer?: (customer: Loose) => void;
    onEdit: (item: PlannerItem) => void;
    onDelete: (id: string) => void;
    /** Whether this stop is yours to change (the team calendar shows others', read only). */
    editable?: (item: PlannerItem) => boolean;
    /** More than you is on screen: each stop says whose calendar it's on. */
    showOwner?: boolean;
};

/**
 * One stop in a day column or the weekend rail: open, edit, delete, drag.
 * On a phone (SalesPage.css, under 640px) the time sits in its own column and
 * the pencil and bin collapse into one "⋯" that opens Edit / Delete under the
 * card, so a long name keeps its width and every button is a full touch target.
 */
export default function PlannerCard({ item, move, onSelectCustomer, onEdit, onDelete, editable, showOwner = false }: { item: PlannerItem } & CardActions) {
    const flag = visitFlag(item);
    const canChange = editable ? editable(item) : true;
    const owner = showOwner ? String(item.ownerName || '').trim() : '';
    const drag = move.dragProps(item);
    const movable = 'draggable' in drag;
    const [open, setOpen] = useState(false);
    const { clock, period } = timeParts(item.startTime);
    const length = lengthOf(item);
    return (
        <div
            className={`pl-item pl-item--${activityModifier(item.activityType)}${move.itemState(item)}${flag ? ` is-${flag}` : ''}${open ? ' is-open' : ''}${canChange ? '' : ' is-readonly'}`}
            title={movable ? `${customerName(item)} — drag to another day, or press Space to move it with the arrow keys` : `${customerName(item)}${owner ? ` — ${owner}'s calendar` : ''}`}
            {...drag}
        >
            <div className="pl-time">
                <span className="pl-time-clock">{clock}</span>
                {period && <span className="pl-time-period">{period}</span>}
            </div>
            <div className="pl-item-top">
                <span
                    className="pl-typedot"
                    style={{ background: activityColor(item.activityType) }}
                    aria-hidden="true"
                />
                <button
                    type="button"
                    className="pl-name"
                    onClick={() => onSelectCustomer && onSelectCustomer(item.customerId as Loose)}
                    title={`Open ${customerName(item)}`}
                >
                    {customerName(item)}
                </button>
                {canChange && (
                <div className="pl-acts">
                    <button type="button" className="pl-act" onClick={() => onEdit(item)} aria-label="Edit activity">
                        <Edit2 size={13} />
                    </button>
                    <button type="button" className="pl-act pl-act--danger" onClick={() => onDelete(item._id)} aria-label="Delete activity">
                        <Trash2 size={13} />
                    </button>
                </div>
                )}
                {canChange && (
                <button
                    type="button"
                    className="pl-kebab"
                    aria-expanded={open}
                    aria-label={`More for ${customerName(item)}`}
                    onClick={() => setOpen(o => !o)}
                >
                    <Ellipsis size={20} />
                </button>
                )}
            </div>
            <div className="pl-meta">
                {owner && <span className="pl-owner">{owner} · </span>}
                <span className="pl-meta-time">{timeLabel(item.startTime)} · </span>{item.activityType || 'Visit'}{length && ` · ${length}`}
                {/* source 'visit_log' = added by logging a visit with
                    nothing scheduled (src/services/visitSchedule.js). */}
                {flag === 'done' && (item.source === 'visit_log' ? (
                    <span className="pl-visit-flag pl-visit-flag--done" title="Not planned — added when the visit was logged">
                        <Check size={11} /> Drop-in
                    </span>
                ) : (
                    <span className="pl-visit-flag pl-visit-flag--done"><Check size={11} /> Visited</span>
                ))}
                {flag === 'missed' && (
                    <span className="pl-visit-flag pl-visit-flag--missed"><AlertTriangle size={11} /> Missed</span>
                )}
            </div>
            {item.notes && <div className="pl-note" title={item.notes}>{item.notes}</div>}
            {canChange && (
            <div className="pl-drawer">
                <button type="button" className="pl-drawer-btn" onClick={() => { setOpen(false); onEdit(item); }}>
                    <Edit2 size={16} /> Edit
                </button>
                <button type="button" className="pl-drawer-btn pl-drawer-btn--danger" onClick={() => { setOpen(false); onDelete(item._id); }}>
                    <Trash2 size={16} /> Delete
                </button>
            </div>
            )}
        </div>
    );
}
