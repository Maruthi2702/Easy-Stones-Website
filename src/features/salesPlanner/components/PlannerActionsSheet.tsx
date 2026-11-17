import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Edit2, ExternalLink, Navigation, Trash2, X } from 'lucide-react';
import { lockPage, unlockPage } from '../../../components/shared/pageLock';
import { trapTab } from '../../../components/shared/form/formFocus';
import type { PlannerItem } from '../plannerSchedule';
import { customerName, timeLabel } from '../salesPlanner';

export default function PlannerActionsSheet({ item, onClose, onOpenCustomer, onDirections, onEdit, onDelete, onOpenCalendar }: {
    item: PlannerItem;
    onClose: () => void;
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
    return createPortal(
        <div className="pl-wrap pl-actions-overlay">
            <div className="pl-actions-backdrop" onClick={onClose} aria-hidden="true" />
            <div ref={dialogRef} className="pl-actions-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-fm-layer=""
                onKeyDown={e => {
                    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
                    else if (e.key === 'Tab') trapTab(e, dialogRef.current?.parentElement);
                }}>
                <div className="pl-actions-grip" aria-hidden="true" />
                <div className="pl-actions-heading">
                    <div>
                        <p>{timeLabel(item.startTime)} · {item.activityType || 'Visit'}</p>
                        <h2 id={titleId}>{customerName(item)}</h2>
                    </div>
                    <button type="button" className="pl-actions-close" aria-label="Close activity actions" onClick={onClose}><X size={20} /></button>
                </div>
                {item.notes && <p className="pl-actions-note">{item.notes}</p>}
                <div className="pl-actions-list">
                    {onDirections && <button type="button" className="pl-actions-directions" onClick={() => choose(onDirections)}><Navigation size={20} /> Directions</button>}
                    {onOpenCustomer && <button type="button" onClick={() => choose(onOpenCustomer)}><ExternalLink size={20} /> Open profile</button>}
                    {onOpenCalendar && <button type="button" onClick={() => choose(onOpenCalendar)}><CalendarDays size={20} /> Edit in Calendar</button>}
                    {onEdit && <button type="button" onClick={() => choose(onEdit)}><Edit2 size={20} /> Edit schedule</button>}
                    {onDelete && <button type="button" className="pl-actions-delete" onClick={() => choose(onDelete)}><Trash2 size={20} /> Delete activity</button>}
                </div>
                <button type="button" className="pl-actions-cancel" onClick={onClose}>Cancel</button>
            </div>
        </div>, document.body
    );
}
