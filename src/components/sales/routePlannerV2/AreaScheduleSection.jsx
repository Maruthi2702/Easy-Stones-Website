import React from 'react';
import { Route, Trash2, Check } from 'lucide-react';
import { friendlyDate } from './helpers';
import './AreaScheduleSection.css';

/**
 * The inline scheduling form for the area-customer-list panel — Date/Start/
 * Mins-per-stop, the live run summary, and the Schedule/Clear/Replace-
 * existing actions that used to live in the run drawer's expanded view
 * (removed — this panel covers the same ground). Rendered as a normal block
 * between the panel head and the scrollable customer list (MapCanvas
 * conditions this on AreaScheduleTrigger's open state) rather than an
 * absolutely-positioned popover — the popover version floated on top of the
 * list and hid part of it; a block in normal flow just pushes it down.
 */
const AreaScheduleSection = ({
    date, onDateChange, startAt, onStartAtChange, stopMinutes, onStopMinutesChange,
    day, summary, can, saving, onScheduleDay, replaceExisting, onReplaceExistingChange,
    onClearPlannedDay, saved
}) => {
    const hasDay = day.length > 0;

    return (
        <div className="rpv2-area-schedule-section">
            <div className="rpv2-area-schedule-fields">
                <label className="rpv2-area-schedule-field">
                    <span>Date</span>
                    <input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} />
                </label>
                <label className="rpv2-area-schedule-field">
                    <span>Start</span>
                    <input type="time" value={startAt} onChange={(e) => onStartAtChange(e.target.value)} />
                </label>
                <label className="rpv2-area-schedule-field">
                    <span>Mins/stop</span>
                    <input
                        type="number" min="10" max="240" step="5" value={stopMinutes}
                        onChange={(e) => onStopMinutesChange(e.target.value)}
                    />
                </label>
            </div>

            {hasDay && (
                <div className="rpv2-area-schedule-summary">
                    <strong>{summary.stops} stops · {summary.miles} mi</strong>
                    <span>{Math.round(summary.drivingMinutes / 6) / 10} hrs driving · ends {summary.endsAt?.slice(11, 16)}</span>
                </div>
            )}

            {can.replace && (
                <label className="rpv2-area-schedule-check">
                    <input
                        type="checkbox"
                        checked={replaceExisting}
                        onChange={(e) => onReplaceExistingChange(e.target.checked)}
                    />
                    <span>Replace stops already planned for this date</span>
                </label>
            )}

            <div className="rpv2-area-schedule-actions">
                {can.plan ? (
                    <button
                        type="button"
                        className="rpv2-area-schedule-primary"
                        disabled={!hasDay || saving}
                        onClick={onScheduleDay}
                    >
                        <Route size={14} />
                        {saving ? 'Scheduling…' : `Put ${day.length || 'these'} stop${day.length === 1 ? '' : 's'} on ${friendlyDate(date)}`}
                    </button>
                ) : (
                    <p className="rpv2-area-schedule-hint">
                        Adding this to a calendar needs the &ldquo;Plan&rdquo; permission on Route Planner.
                    </p>
                )}
                {can.clear && (
                    <button
                        type="button"
                        className="rpv2-area-schedule-secondary"
                        disabled={saving}
                        onClick={onClearPlannedDay}
                        title="Clear the stops the route planner put on this date"
                        aria-label="Clear the stops the route planner put on this date"
                    >
                        <Trash2 size={13} />
                    </button>
                )}
            </div>

            {saved && (
                <p className="rpv2-area-schedule-saved">
                    <Check size={13} />
                    {saved.cleared !== undefined
                        ? ` ${saved.cleared} planned stop${saved.cleared === 1 ? '' : 's'} removed from ${saved.date}.`
                        : ` ${saved.count} stop${saved.count === 1 ? '' : 's'} added to your planner for ${saved.date}` +
                          (saved.replaced ? `, replacing ${saved.replaced}.` : '.')}
                </p>
            )}
        </div>
    );
};

export default AreaScheduleSection;
