import { Edit2, Trash2, Check, AlertTriangle } from 'lucide-react';
import type { PlannerItem } from '../plannerSchedule';
import type { StopMove } from '../useMoveStop';
import { activityModifier, activityColor, customerName, timeLabel, visitFlag } from '../salesPlanner';
import type { Loose } from '../../../types/records';

export type CardActions = {
    move: StopMove;
    onSelectCustomer?: (customer: Loose) => void;
    onEdit: (item: PlannerItem) => void;
    onDelete: (id: string) => void;
};

/** One stop in a day column or the weekend rail: open, edit, delete, drag. */
export default function PlannerCard({ item, move, onSelectCustomer, onEdit, onDelete }: { item: PlannerItem } & CardActions) {
    const flag = visitFlag(item);
    return (
        <div
            className={`pl-item pl-item--${activityModifier(item.activityType)}${move.itemState(item)}${flag ? ` is-${flag}` : ''}`}
            title={`${customerName(item)} — drag to another day, or press Space to move it with the arrow keys`}
            {...move.dragProps(item)}
        >
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
                <div className="pl-acts">
                    <button type="button" className="pl-act" onClick={() => onEdit(item)} aria-label="Edit activity">
                        <Edit2 size={13} />
                    </button>
                    <button type="button" className="pl-act pl-act--danger" onClick={() => onDelete(item._id)} aria-label="Delete activity">
                        <Trash2 size={13} />
                    </button>
                </div>
            </div>
            <div className="pl-meta">
                {timeLabel(item.startTime)} · {item.activityType || 'Visit'}
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
        </div>
    );
}
