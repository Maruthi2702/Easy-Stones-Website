import React, { useEffect, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import { friendlyDate } from './helpers';
import './ScheduleSummaryButton.css';

/**
 * The collapsed row's date/"Today's run" summary, tucked behind an icon —
 * same pattern as RecencyFilterButton beside it: a glance-able icon in the
 * always-visible row, the actual text behind a click, rather than every
 * piece of information claiming its own permanent space in a strip that's
 * meant to stay thin.
 */
const ScheduleSummaryButton = ({ date, hasDay, summary }) => {
    const [isOpen, setIsOpen] = useState(false);
    const rootRef = useRef(null);

    useEffect(() => {
        if (!isOpen) return;
        const onOutside = (e) => {
            if (!rootRef.current?.contains(e.target)) setIsOpen(false);
        };
        document.addEventListener('mousedown', onOutside);
        return () => document.removeEventListener('mousedown', onOutside);
    }, [isOpen]);

    return (
        <div className="rpv2-schedule-summary" ref={rootRef}>
            <button
                type="button"
                className="rpv2-schedule-summary-btn"
                onClick={() => setIsOpen(v => !v)}
                title="Today's run"
                aria-label="Today's run"
                aria-expanded={isOpen}
            >
                <Calendar size={16} />
            </button>

            {isOpen && (
                <div className="rpv2-schedule-summary-popover">
                    <div className="rpv2-schedule-summary-date">{friendlyDate(date)}</div>
                    <div className="rpv2-drawer-label">Today's run</div>
                    <div className="rpv2-drawer-headline">
                        {hasDay
                            ? <>{summary.stops} stops · {summary.miles} mi · ends {summary.endsAt?.slice(11, 16)}</>
                            : 'Click the map to start a day'}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ScheduleSummaryButton;
