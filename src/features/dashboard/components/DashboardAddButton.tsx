import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
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
 *
 * It opens as a speed dial (owner's pick, 2026-11-01; claude.ai artifact
 * "Dashboard + menu opening", https://claude.ai/artifact/KsDZ3TUpkexMDGgTJaUNZb,
 * option B): each action pops out of the + as its own round button with a label,
 * nearest first, over a dark, blurred page; the + turns into × with a gold ring.
 * The menu stays in the page while closed (hidden) so it can animate both ways.
 * A tap on the dark page closes it without reaching what's underneath.
 */
export default function DashboardAddButton({ onAddVisit, onAddResource, onScheduleActivity }: DashboardAddButtonProps) {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open]);

    const items = [
        onAddVisit && { key: 'visit', label: 'Add visit', Icon: UserPlus, run: onAddVisit },
        onAddResource && { key: 'resource', label: 'Add resource', Icon: FolderPlus, run: onAddResource },
        onScheduleActivity && { key: 'schedule', label: 'Schedule activity', Icon: Calendar, run: onScheduleActivity }
    ].filter(Boolean) as { key: string; label: string; Icon: typeof Plus; run: () => void }[];
    if (items.length === 0) return null;

    return (
        <div className={`dab${open ? ' is-open' : ''}`}>
            <div className="dab-scrim" aria-hidden="true" onClick={() => setOpen(false)} />
            <div className="dab-menu" role="menu" aria-label="Add" aria-hidden={!open} inert={!open}>
                {items.map(({ key, label, Icon, run }, i) => (
                    <button
                        key={key}
                        type="button"
                        role="menuitem"
                        className="dab-item"
                        // How far from the + (0 = nearest): the pop-out order and distance.
                        style={{ '--k': items.length - 1 - i } as CSSProperties}
                        onClick={() => { setOpen(false); run(); }}
                    >
                        <span className="dab-label">{label}</span>
                        <span className="dab-icon"><Icon size={19} aria-hidden="true" /></span>
                    </button>
                ))}
            </div>
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
