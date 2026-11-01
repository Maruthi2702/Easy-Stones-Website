import { useEffect, useRef, useState } from 'react';
import { Calendar, FolderPlus, Plus, UserPlus } from 'lucide-react';
import './DashboardAddButton.css';

export type DashboardAddButtonProps = {
    /** Each is left out when the login can't do it; with none, no button. */
    onAddVisit?: () => void;
    onAddResource?: () => void;
    onScheduleActivity?: () => void;
};

/**
 * The dashboard's one Add button (owner, 2026-10-31): a round gold + at the bottom
 * right on every tab and screen size, like the Calendar's, in place of the header's
 * Add Visit / Add Resource and the Calendar's Schedule Activity. It opens the same
 * menu everywhere — Add visit, Add resource, Schedule activity. On a phone it sits
 * above the tab bar (--app-bottom-h). Below every form and modal (z-index 90).
 */
export default function DashboardAddButton({ onAddVisit, onAddResource, onScheduleActivity }: DashboardAddButtonProps) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e: MouseEvent | TouchEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('touchstart', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('touchstart', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const items = [
        onAddVisit && { key: 'visit', label: 'Add visit', Icon: UserPlus, run: onAddVisit },
        onAddResource && { key: 'resource', label: 'Add resource', Icon: FolderPlus, run: onAddResource },
        onScheduleActivity && { key: 'schedule', label: 'Schedule activity', Icon: Calendar, run: onScheduleActivity }
    ].filter(Boolean) as { key: string; label: string; Icon: typeof Plus; run: () => void }[];
    if (items.length === 0) return null;

    return (
        <div className="dab" ref={rootRef}>
            {open && (
                <div className="dab-menu" role="menu" aria-label="Add">
                    {items.map(({ key, label, Icon, run }) => (
                        <button key={key} type="button" role="menuitem" className="dab-item" onClick={() => { setOpen(false); run(); }}>
                            <Icon size={16} aria-hidden="true" />
                            {label}
                        </button>
                    ))}
                </div>
            )}
            <button
                type="button"
                className={`dab-btn${open ? ' is-open' : ''}`}
                aria-label="Add: visit, resource or calendar activity"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
            >
                <Plus size={26} strokeWidth={2.6} />
            </button>
        </div>
    );
}
