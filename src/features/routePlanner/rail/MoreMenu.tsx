import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Menu, Search, Gauge, X, Loader2 } from 'lucide-react';
import './MoreMenu.css';

/**
 * The three-line icon at the end of the phone's bottom bar (shown under 720px
 * only — the desktop rail has these controls as icons of their own): a menu of
 * the map options that don't fit on the bar. Today "Find new leads" and "Live
 * traffic"; a new map feature is another row in the list below.
 *
 * Portaled to document.body and positioned from the trigger's screen
 * coordinates, for the reason LeadSearchControl.tsx spells out: the bar scrolls
 * (overflow), which would clip a plain absolute child.
 */
export type MoreMenuProps = {
    leadQuery: string;
    onLeadQueryChange: (value: string) => void;
    onLeadSearch: (query: string) => void;
    leadSearching: boolean;
    recentLeads: string[];
    onRemoveRecent: (term: string) => void;
    showTraffic: boolean;
    onToggleTraffic: () => void;
};

const MoreMenu = ({
    leadQuery, onLeadQueryChange, onLeadSearch, leadSearching, recentLeads, onRemoveRecent,
    showTraffic, onToggleTraffic
}: MoreMenuProps) => {
    const [open, setOpen] = useState(false);
    const [leadsOpen, setLeadsOpen] = useState(false);
    const [bottom, setBottom] = useState(0);
    const triggerRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const close = useCallback(() => { setOpen(false); setLeadsOpen(false); }, []);

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

    useEffect(() => { if (leadsOpen) inputRef.current?.focus(); }, [leadsOpen]);

    const toggle = () => {
        if (!open && triggerRef.current) {
            setBottom(window.innerHeight - triggerRef.current.getBoundingClientRect().top + 8);
        }
        if (open) close(); else setOpen(true);
    };

    const runSearch = (term?: string) => {
        const q = (term ?? leadQuery).trim();
        if (!q) return;
        onLeadSearch(q);
        close();
    };

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
                    <button type="button" role="menuitem" className="rpv2-more-item" onClick={() => setLeadsOpen(v => !v)} aria-expanded={leadsOpen}>
                        <Search size={20} aria-hidden="true" />
                        <span className="rpv2-more-text">
                            Find new leads
                            <small>Search the map for businesses that aren’t customers yet</small>
                        </span>
                    </button>

                    {leadsOpen && (
                        <div className="rpv2-more-leads">
                            <div className="rpv2-lead-row">
                                <Search size={14} className="rpv2-lead-icon" aria-hidden="true" />
                                <input
                                    ref={inputRef}
                                    type="text"
                                    className="rpv2-lead-input"
                                    placeholder="e.g. countertops"
                                    value={leadQuery}
                                    onChange={(e) => onLeadQueryChange(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                                    aria-label="Search for new leads by business type"
                                />
                                {leadQuery && (
                                    <button type="button" className="rpv2-lead-clear" onClick={() => onLeadQueryChange('')} aria-label="Clear search text">
                                        <X size={13} />
                                    </button>
                                )}
                            </div>
                            <button type="button" className="rpv2-lead-search-btn" onClick={() => runSearch()} disabled={leadSearching || !leadQuery.trim()}>
                                {leadSearching ? <Loader2 size={14} className="rpv2-lead-spin" /> : 'Search this area'}
                            </button>
                            {recentLeads.length > 0 && (
                                <div className="rpv2-lead-recent">
                                    {recentLeads.map(term => (
                                        <div key={term} className="rpv2-lead-recent-row">
                                            <button type="button" className="rpv2-lead-recent-term" onClick={() => runSearch(term)}>{term}</button>
                                            <button type="button" className="rpv2-lead-recent-remove" onClick={() => onRemoveRecent(term)} aria-label={`Remove "${term}" from recent searches`}>
                                                <X size={12} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

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
