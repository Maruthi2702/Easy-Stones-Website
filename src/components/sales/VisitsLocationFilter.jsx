import React, { useEffect, useRef, useState } from 'react';
import { Filter, X } from 'lucide-react';

/**
 * Filter button for the dashboard's Sales Visits list, opening a small panel
 * with a Location dropdown. The server narrows the list to that branch and
 * never beyond the viewer's own scope (narrowScopeToLocation in
 * src/utils/dashboardMatch.js), so `options` is only what to offer.
 *
 * A native <select>, not the shared CustomSelect: CustomSelect portals its
 * options to document.body, so picking one would read as a click outside this
 * panel and close it mid-choice.
 */
const VisitsLocationFilter = ({ options = [], value = '', onChange }) => {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('touchstart', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('touchstart', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    if (options.length < 2) return null;

    return (
        <div className="vlf" ref={rootRef}>
            <button
                type="button"
                className={`vlf-btn${value ? ' is-active' : ''}`}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={value ? `Filter visits: ${value}` : 'Filter visits'}
                onClick={() => setOpen(o => !o)}
            >
                <Filter size={17} aria-hidden="true" />
                {value && <span className="vlf-btn-label">{value}</span>}
            </button>

            {open && (
                <div className="vlf-panel" role="dialog" aria-label="Filter visits">
                    <label className="vlf-label" htmlFor="vlf-location">Location</label>
                    <select
                        id="vlf-location"
                        className="vlf-select"
                        value={value}
                        onChange={(e) => onChange?.(e.target.value)}
                    >
                        <option value="">All locations</option>
                        {options.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                    </select>
                    {value && (
                        <button type="button" className="vlf-clear" onClick={() => onChange?.('')}>
                            <X size={14} aria-hidden="true" /> Clear filter
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default VisitsLocationFilter;
