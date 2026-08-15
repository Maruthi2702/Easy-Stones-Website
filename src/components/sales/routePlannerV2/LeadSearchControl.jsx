import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Loader2 } from 'lucide-react';
import './LeadSearchControl.css';

/**
 * "Find new leads": a small search icon in the run drawer's nav column that
 * expands into a text query + "Search this area" action, scoped to whatever
 * the map currently shows — there's no separate area picker, panning/zooming
 * the map IS the area. Recent queries persist per-browser
 * (loadRecentLeadSearches/saveRecentLeadSearch in helpers.js) so a rep can
 * re-run "hardware store" in a new town without retyping it, mirroring the
 * recent-searches list in Badger Maps' lead generation panel.
 *
 * The flyout is portaled to document.body and positioned from the trigger's
 * real screen coordinates, same as CustomSelect (src/components/shared) —
 * this control used to live in the old floating top bar, where a plain
 * position:absolute child worked fine, but RunDrawer's nav column
 * (.rpv2-drawer) sets overflow-y:auto for its own icon list, which per the
 * CSS overflow spec forces overflow-x to auto too (a UA cannot clip one
 * axis and leave the other visible). That silently clipped the flyout to
 * the drawer's 56px width the moment this control was relocated into it,
 * same failure mode as the CustomSelect incident in CLAUDE.md — the input
 * was rendering, just outside the drawer's paintable box.
 */
const LeadSearchControl = ({ query, onQueryChange, onSearch, searching, recent, onRemoveRecent }) => {
    const [open, setOpen] = useState(false);
    const [coords, setCoords] = useState(null);
    const rootRef = useRef(null);
    const flyoutRef = useRef(null);
    const inputRef = useRef(null);

    const updateCoords = useCallback(() => {
        const el = rootRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const width = window.innerWidth <= 720 ? 220 : 260;
        const left = Math.min(rect.right + 10, window.innerWidth - width - 8);
        setCoords({ left, top: rect.top - 8, width });
    }, []);

    useEffect(() => {
        if (!open) return;
        const onDocClick = (e) => {
            const inTrigger = rootRef.current?.contains(e.target);
            const inFlyout = flyoutRef.current?.contains(e.target);
            if (!inTrigger && !inFlyout) setOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [open]);

    // Kept in sync with the trigger's own position — the drawer itself
    // doesn't scroll under normal use, but the window can still resize.
    useEffect(() => {
        if (!open) return;
        window.addEventListener('resize', updateCoords);
        return () => window.removeEventListener('resize', updateCoords);
    }, [open, updateCoords]);

    // Focuses the input the moment the flyout opens, since opening it has no
    // other purpose than typing a query — saves the extra click a rep would
    // otherwise need after tapping the icon.
    useEffect(() => {
        if (open) inputRef.current?.focus();
    }, [open]);

    const toggleOpen = () => {
        if (!open) updateCoords();
        setOpen(v => !v);
    };

    const runSearch = (term) => {
        const q = (term ?? query).trim();
        if (!q) return;
        onSearch(q);
    };

    return (
        <div className="rpv2-lead-pill" ref={rootRef}>
            <button
                type="button"
                className={`rpv2-lead-trigger ${open ? 'is-on' : ''}`}
                onClick={toggleOpen}
                title="Find new leads"
                aria-label="Find new leads"
                aria-expanded={open}
            >
                <Search size={16} />
            </button>

            {open && coords && createPortal(
                <div
                    ref={flyoutRef}
                    className="rpv2-lead-flyout"
                    style={{ position: 'fixed', left: coords.left, top: coords.top, width: coords.width }}
                >
                    <div className="rpv2-lead-row">
                        <Search size={14} className="rpv2-lead-icon" aria-hidden="true" />
                        <input
                            ref={inputRef}
                            type="text"
                            className="rpv2-lead-input"
                            placeholder="Find new leads (e.g. countertops)"
                            value={query}
                            onChange={(e) => onQueryChange(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                            aria-label="Search for new leads by business type"
                        />
                        {query && (
                            <button type="button" className="rpv2-lead-clear" onClick={() => onQueryChange('')} aria-label="Clear search text">
                                <X size={13} />
                            </button>
                        )}
                    </div>

                    <button
                        type="button"
                        className="rpv2-lead-search-btn"
                        onClick={() => runSearch()}
                        disabled={searching || !query.trim()}
                        title="Search the area currently on screen"
                    >
                        {searching ? <Loader2 size={14} className="rpv2-lead-spin" /> : 'Search this area'}
                    </button>

                    {recent.length > 0 && (
                        <div className="rpv2-lead-recent">
                            {recent.map(term => (
                                <div key={term} className="rpv2-lead-recent-row">
                                    <button type="button" className="rpv2-lead-recent-term" onClick={() => runSearch(term)}>
                                        {term}
                                    </button>
                                    <button
                                        type="button"
                                        className="rpv2-lead-recent-remove"
                                        onClick={(e) => { e.stopPropagation(); onRemoveRecent(term); }}
                                        aria-label={`Remove "${term}" from recent searches`}
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
};

export default LeadSearchControl;
