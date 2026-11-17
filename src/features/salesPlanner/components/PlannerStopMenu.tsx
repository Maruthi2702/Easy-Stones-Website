import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Edit2, Ellipsis, ExternalLink, Info, Navigation, Trash2 } from 'lucide-react';
import type { PlannerItem } from '../plannerSchedule';
import { customerName } from '../salesPlanner';

export type PlannerStopMenuProps = {
    item: PlannerItem;
    /** Each is absent when the person may not do it (or the stop has no customer). */
    onDirections?: () => void;
    /** The customer's basic card (the same one the dashboard's customer search opens). */
    onViewDetails?: () => void;
    onOpenCustomer?: () => void;
    onEdit?: () => void;
    onDelete?: () => void;
    /** Outside the Calendar (the Visits tab's Today panel): "Edit in Calendar" instead of Edit / Delete. */
    onOpenCalendar?: () => void;
};

const WIDTH = 208;

/**
 * A stop's \u22ef menu on a tablet or desktop (a phone has PlannerActionsSheet):
 * Directions, View details, Open profile, then Edit schedule and Delete under a line. It floats
 * on the screen beside its button, not inside the day column, because the columns
 * clip (the same reason as the Customers tables' RowMenu).
 */
export default function PlannerStopMenu({ item, onDirections, onViewDetails, onOpenCustomer, onEdit, onDelete, onOpenCalendar }: PlannerStopMenuProps) {
    const [open, setOpen] = useState(false);
    const [at, setAt] = useState<{ top: number; left: number } | null>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const menu = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        if (!open || !trigger.current) return;
        const rect = trigger.current.getBoundingClientRect();
        const height = menu.current?.offsetHeight ?? 200;
        const left = Math.max(8, Math.min(window.innerWidth - WIDTH - 8, rect.right - WIDTH));
        const below = rect.bottom + 4;
        const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 4) : below;
        setAt({ top, left });
    }, [open]);

    useEffect(() => {
        if (!open) return;
        menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
        const close = () => setOpen(false);
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); trigger.current?.focus({ preventScroll: true }); }
            else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
                const i = items.indexOf(document.activeElement as HTMLElement);
                items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus({ preventScroll: true });
            }
        };
        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);
        document.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('resize', close);
            window.removeEventListener('scroll', close, true);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    if (!onDirections && !onViewDetails && !onOpenCustomer && !onEdit && !onDelete && !onOpenCalendar) return null;
    const choose = (action: () => void) => { setOpen(false); action(); };
    const hasChange = Boolean(onEdit || onDelete || onOpenCalendar);
    return (
        <>
            <button
                ref={trigger}
                type="button"
                className="pl-stopmenu-btn"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={`More for ${customerName(item)}`}
                onClick={() => setOpen(o => !o)}
            >
                <Ellipsis size={16} />
            </button>
            {open && createPortal(
                <div className="pl-wrap pl-menu-layer" onMouseDown={() => setOpen(false)}>
                    <div
                        ref={menu}
                        className="pl-stopmenu"
                        role="menu"
                        aria-label={`Actions for ${customerName(item)}`}
                        style={{ top: at?.top ?? -9999, left: at?.left ?? -9999, width: WIDTH }}
                        onMouseDown={e => e.stopPropagation()}
                    >
                        {onDirections && <button type="button" role="menuitem" className="pl-stopmenu-item pl-stopmenu-item--directions" onClick={() => choose(onDirections)}><Navigation size={15} /> Directions</button>}
                        {onViewDetails && <button type="button" role="menuitem" className="pl-stopmenu-item" onClick={() => choose(onViewDetails)}><Info size={15} /> View details</button>}
                        {onOpenCustomer && <button type="button" role="menuitem" className="pl-stopmenu-item" onClick={() => choose(onOpenCustomer)}><ExternalLink size={15} /> Open profile</button>}
                        {hasChange && (onDirections || onViewDetails || onOpenCustomer) && <div className="pl-stopmenu-sep" role="separator" />}
                        {onOpenCalendar && <button type="button" role="menuitem" className="pl-stopmenu-item" onClick={() => choose(onOpenCalendar)}><CalendarDays size={15} /> Edit in Calendar</button>}
                        {onEdit && <button type="button" role="menuitem" className="pl-stopmenu-item" onClick={() => choose(onEdit)}><Edit2 size={15} /> Edit schedule</button>}
                        {onDelete && <button type="button" role="menuitem" className="pl-stopmenu-item pl-stopmenu-item--danger" onClick={() => choose(onDelete)}><Trash2 size={15} /> Delete</button>}
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
