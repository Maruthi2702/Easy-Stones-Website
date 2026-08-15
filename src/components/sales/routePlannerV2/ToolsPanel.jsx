import React from 'react';
import { Target, Circle, Lasso, X, CalendarPlus, ChevronUp } from 'lucide-react';
import { nameOf } from './helpers';
import AreaScheduleSection from './AreaScheduleSection';
import './ToolsPanel.css';

/**
 * The "Tools" panel — same fixed right column every other rpv2-panel uses,
 * opened from RunDrawer's tool icon rather than a pin click. This is the
 * one way a day gets built: pick Radius (drag a circle) or Lasso (trace a
 * freehand outline) anywhere on the map, and whatever falls inside becomes
 * the stop-ordered selected customers listed below — replacing whatever
 * was selected before, not adding to it. That selection persists
 * independent of the type/recency/rep filters narrowing the map, and
 * across removing points one at a time, until it's cleared or scheduled.
 * The standalone "Selected customers" panel this used to share the same
 * selection with (RunDrawer's Users icon, MapCanvas's old showAreaList)
 * was removed once this panel covered the identical ground — one place
 * to view/manage a selection, not two.
 *
 * Scheduling reuses AreaScheduleSection as-is (the same date/start-time/
 * mins-per-stop fields and run summary that removed panel used to show for
 * this identical day) — a plain "Create Route" button used to sit here
 * instead, calling the same scheduleDay underneath but with none of that
 * context visible before committing. The trigger itself is its own
 * full-width button here rather than AreaScheduleTrigger, which was built
 * as a small icon for a header row beside a title — alone in this footer
 * (which used to hold a full-width primary button) it read as an
 * undersized, floating afterthought instead of this panel's one
 * committing action.
 */
const ToolsPanel = ({
    onClose,
    mode, onArmRadius, onArmLasso,
    selectedPins, orderById, colors, onRemovePoint, onSelectPin,
    can, saving,
    date, onDateChange, startAt, onStartAtChange, stopMinutes, onStopMinutesChange,
    day, summary, onScheduleDay, replaceExisting, onReplaceExistingChange, onClearPlannedDay, saved,
    scheduleOpen, onToggleSchedule
}) => (
    <div className="rpv2-panel" data-dialog="tools">
        <div className="rpv2-panel-head">
            <div className="rpv2-panel-head-top">
                <Target size={16} />
                <span className="rpv2-panel-head-title">Tools</span>
                <button type="button" className="rpv2-panel-close" onClick={onClose} aria-label="Close">
                    <X size={18} />
                </button>
            </div>
        </div>

        <div className="rpv2-tools-body">
            <div className="rpv2-tools-mode-row">
                <button
                    type="button"
                    className={`rpv2-tools-mode-btn ${mode === 'radius' ? 'is-armed' : ''}`}
                    onClick={onArmRadius}
                    aria-pressed={mode === 'radius'}
                >
                    <Circle size={15} />
                    Radius
                </button>
                <button
                    type="button"
                    className={`rpv2-tools-mode-btn ${mode === 'lasso' ? 'is-armed' : ''}`}
                    onClick={onArmLasso}
                    aria-pressed={mode === 'lasso'}
                >
                    <Lasso size={15} />
                    Lasso
                </button>
            </div>
            <p className="rpv2-tools-hint">
                {mode === 'radius' && 'Click and drag on the map to draw a circle — everything inside it becomes the selection below.'}
                {mode === 'lasso' && 'Click and drag to trace an outline — everything inside it becomes the selection below.'}
                {!mode && 'Choose Radius or Lasso, then draw on the map to select customers.'}
            </p>

            <div className="rpv2-tools-selected-head">
                Selected customers ({selectedPins.length})
            </div>
        </div>

        <div className="rpv2-panel-list rpv2-tools-list">
            {selectedPins.length === 0 && (
                <p className="rpv2-panel-list-empty">Nothing selected yet.</p>
            )}
            {/* Stop order, not whatever order selectedPins itself happens
                to be in — reads as an itinerary rather than an arbitrary
                list. */}
            {[...selectedPins]
                .sort((a, b) => (orderById.get(a._id) ?? Infinity) - (orderById.get(b._id) ?? Infinity))
                .map(pin => (
                <div key={pin._id} className="rpv2-panel-list-row">
                    <span className="rpv2-panel-list-dot" style={{ background: colors[pin.recency.key] }} aria-hidden="true" />
                    <div
                        className="rpv2-panel-list-body"
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectPin(pin, 'tools')}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectPin(pin, 'tools'); } }}
                    >
                        <span className="rpv2-panel-list-name">{nameOf(pin)}</span>
                        <span className="rpv2-panel-list-meta">{[pin.city, pin.customerType].filter(Boolean).join(' · ')}</span>
                    </div>
                    {orderById.has(pin._id) && <span className="rpv2-panel-stop">Stop {orderById.get(pin._id)}</span>}
                    <button
                        type="button"
                        className="rpv2-panel-icon-btn is-danger"
                        onClick={() => onRemovePoint(pin)}
                        title="Remove from selection"
                        aria-label={`Remove ${nameOf(pin)} from the selection`}
                    >
                        <X size={14} />
                    </button>
                </div>
            ))}
        </div>

        {scheduleOpen && (
            <AreaScheduleSection
                date={date}
                onDateChange={onDateChange}
                startAt={startAt}
                onStartAtChange={onStartAtChange}
                stopMinutes={stopMinutes}
                onStopMinutesChange={onStopMinutesChange}
                day={day}
                summary={summary}
                can={can}
                saving={saving}
                onScheduleDay={onScheduleDay}
                replaceExisting={replaceExisting}
                onReplaceExistingChange={onReplaceExistingChange}
                onClearPlannedDay={onClearPlannedDay}
                saved={saved}
            />
        )}

        <div className="rpv2-panel-actions rpv2-tools-actions">
            <button
                type="button"
                className="is-primary"
                onClick={onToggleSchedule}
                aria-expanded={scheduleOpen}
            >
                {scheduleOpen ? <ChevronUp size={14} /> : <CalendarPlus size={14} />}
                {scheduleOpen ? 'Hide schedule' : 'Schedule'}
                {day.length > 0 && <span className="rpv2-tools-schedule-count">{day.length}</span>}
            </button>
        </div>
    </div>
);

export default ToolsPanel;
