import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Menu, Search, Gauge, ChevronRight } from 'lucide-react';
import './MoreMenu.css';

/**
 * The three-line icon at the end of the phone's bottom bar (shown under 720px
 * only — the desktop rail has these controls as icons of their own): a menu of
 * the map options that don't fit on the bar. Today "Find new leads" (which opens the
 * phone's lead search, leadsPhone/) and "Live traffic"; a new map feature is another row in
 * the list below.
 *
 * Portaled to document.body and positioned from the trigger's screen
 * coordinates, for the reason LeadSearchControl.tsx spells out: the bar scrolls
 * (overflow), which would clip a plain absolute child.
 */
export type MoreMenuProps = {
    /** Opens the phone's lead search (LeadsPhone): a search bar at the top of the screen. */
    onFindLeads: () => void;
    showTraffic: boolean;
    onToggleTraffic: () => void;
};

const MoreMenu = ({ onFindLeads, showTraffic, onToggleTraffic }: MoreMenuProps) => {
    const [open, setOpen] = useState(false);
    const [bottom, setBottom] = useState(0);
    const triggerRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const close = useCallback(() => setOpen(false), []);

    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e: MouseEvent | TouchEvent) => {
            if (triggerRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
            close();
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('touchstart', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('touchstart', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open, close]);

    const toggle = () => {
        if (!open && triggerRef.current) {
            setBottom(window.innerHeight - triggerRef.current.getBoundingClientRect().top + 8);
        }
        if (open) close(); else setOpen(true);
    };

    const findLeads = () => { close(); onFindLeads(); };

    return (
        <div className="rpv2-more" ref={triggerRef}>
            <button
                type="button"
                className={`rpv2-drawer-list-btn ${open ? 'is-on' : ''}`}
                onClick={toggle}
                title="More map options"
                aria-label="More map options"
                aria-haspopup="menu"
                aria-expanded={open}
            >
                <Menu size={16} />
            </button>

            {open && createPortal(
                <div ref={menuRef} className="rpv2-more-menu" role="menu" aria-label="More map options" style={{ bottom }}>
                    <button type="button" role="menuitem" className="rpv2-more-item" onClick={findLeads}>
                        <Search size={20} aria-hidden="true" />
                        <span className="rpv2-more-text">
                            Find new leads
                            <small>Search the map for businesses that aren’t customers yet</small>
                        </span>
                        <ChevronRight size={18} aria-hidden="true" />
                    </button>

                    <button type="button" role="menuitemcheckbox" aria-checked={showTraffic} className="rpv2-more-item" onClick={onToggleTraffic}>
                        <Gauge size={20} aria-hidden="true" />
                        <span className="rpv2-more-text">Live traffic</span>
                        <span className={`rpv2-more-switch ${showTraffic ? 'is-on' : ''}`} aria-hidden="true"><span /></span>
                    </button>
                </div>,
                document.body
            )}
        </div>
    );
};

export default MoreMenu;
