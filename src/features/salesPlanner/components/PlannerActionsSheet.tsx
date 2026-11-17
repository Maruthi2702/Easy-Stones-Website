import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Edit2, ExternalLink, Info, Navigation, Trash2, X } from 'lucide-react';
import '../../../components/shared/form/FormModal.css';
import { lockPage, unlockPage } from '../../../components/shared/pageLock';
import { trapTab } from '../../../components/shared/form/formFocus';
import type { PlannerItem } from '../plannerSchedule';
import { customerName, timeLabel } from '../salesPlanner';

export default function PlannerActionsSheet({ item, onClose, onViewDetails, onOpenCustomer, onDirections, onEdit, onDelete, onOpenCalendar }: {
    item: PlannerItem;
    onClose: () => void;
    /** The customer's basic card. */
    onViewDetails?: () => void;
    onOpenCustomer?: () => void;
    /** Maps directions to the customer; absent when the stop has no customer. */
    onDirections?: () => void;
    onEdit?: () => void;
    onDelete?: () => void;
    /** Outside the Calendar (the Visits tab's Today panel): "Edit in Calendar" instead of Edit / Delete. */
    onOpenCalendar?: () => void;
}) {
    const titleId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        lockPage();
        dialogRef.current?.focus({ preventScroll: true });
        return () => {
            unlockPage();
            if (previous?.isConnected) previous.focus({ preventScroll: true });
        };
    }, []);

    const choose = (action: () => void) => { onClose(); action(); };
    // The form template's phone bottom sheet (FORM_TEMPLATE.md; .fm-sheet in FormModal.css and its --fm-* tokens),
    // so it looks and behaves like every other sheet: grip, title with the round ✕, 48px rows.
    return createPortal(
        <div className="fm-tokens pl-actions-overlay">
            <div className="fm-sheet-backdrop" onClick={onClose} aria-hidden="true" />
            <div ref={dialogRef} className="fm-sheet pl-actions-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-fm-layer=""
                onKeyDown={e => {
                    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
                    else if (e.key === 'Tab') trapTab(e, dialogRef.current?.parentElement);
                }}>
                <div className="fm-sheet-head pl-actions-head">
                    <div className="pl-actions-title">
                        <p>{timeLabel(item.startTime)} · {item.activityType || 'Visit'}</p>
                        <h2 id={titleId} className="fm-sheet-title">{customerName(item)}</h2>
                    </div>
                    <button type="button" className="fm-close" aria-label="Close" title="Close (Esc)" onClick={onClose}><X size={18} strokeWidth={2.4} aria-hidden="true" /></button>
                </div>
                {item.notes && <div className="pl-actions-note"><span>Note</span><p>{item.notes}</p></div>}
                <div className="fm-sheet-body pl-actions-list">
                    {onDirections && <button type="button" className="fm-opt pl-actions-directions" onClick={() => choose(onDirections)}><Navigation size={18} /> Directions</button>}
 {onViewDetails && <button type="button" className="fm-opt" onClick={() => choose(onViewDetails)}><Info size={18} /> View details</button>}
                    {onOpenCustomer && <button type="button" className="fm-opt" onClick={() => choose(onOpenCustomer)}><ExternalLink size={18} /> Open profile</button>}
                    {onOpenCalendar && <button type="button" className="fm-opt" onClick={() => choose(onOpenCalendar)}><CalendarDays size={18} /> Edit in Calendar</button>}
                    {(onEdit || onDelete) && (onDirections || onViewDetails || onOpenCustomer || onOpenCalendar) && <div className="pl-actions-sep" role="separator" />}
                    {onEdit && <button type="button" className="fm-opt" onClick={() => choose(onEdit)}><Edit2 size={18} /> Edit schedule</button>}
                    {onDelete && <button type="button" className="fm-opt pl-actions-delete" onClick={() => choose(onDelete)}><Trash2 size={18} /> Delete activity</button>}
                </div>
            </div>
        </div>, document.body
    );
}
