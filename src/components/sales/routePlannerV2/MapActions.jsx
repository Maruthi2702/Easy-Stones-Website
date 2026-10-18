import React from 'react';
import { CalendarPlus, CalendarX, CalendarClock, FolderPlus, FilePlus2 } from 'lucide-react';
import { whenLabel } from './helpers';
import './MapActions.css';

/**
 * What the Route Planner adds to a customer in the shared customer panel
 * (CustomerDrawer's `mapSection`): how long since the last visit, where the
 * customer sits on the day being planned or when it is booked, and the map's
 * actions — put it on a day, add a visit, add a resource. Everything else in the
 * panel is the Customers tab's own, so it changes with that.
 */
const MapActions = ({
    pin, colors, stop = null, booking = null,
    canPlan, saving, onSchedule, onRemove, onAddVisit, onAddResource
}) => {
    const recency = pin?.recency;
    const never = recency?.key === 'never';
    return (
        <section className="rpv2-mapsec" aria-label="On the map">
            <div className="rpv2-mapsec-chips">
                {recency && (
                    <span className="rpv2-mapsec-chip" style={{ '--chip': colors[recency.key] }}>
                        <span className="rpv2-mapsec-dot" aria-hidden="true" />
                        {never ? 'Never visited' : `Last visit ${recency.label}`}
                    </span>
                )}
                {booking ? (
                    <span className="rpv2-mapsec-chip is-gold">Scheduled {whenLabel(booking.startTime)}</span>
                ) : stop ? (
                    <span className="rpv2-mapsec-chip is-gold">Stop {stop.order} on the day being planned</span>
                ) : null}
                {booking && canPlan && (
                    <button type="button" className="rpv2-mapsec-link" onClick={onSchedule} disabled={saving}>Reschedule</button>
                )}
            </div>

            <div className="rpv2-mapsec-actions">
                {canPlan && (booking ? (
                    <button type="button" onClick={onRemove} disabled={saving}>
                        <CalendarX size={17} aria-hidden="true" />Remove from calendar
                    </button>
                ) : (
                    <button type="button" onClick={onSchedule} disabled={saving}>
                        <CalendarPlus size={17} aria-hidden="true" />Add to calendar
                    </button>
                ))}
                {onAddVisit && (
                    <button type="button" onClick={onAddVisit}>
                        <CalendarClock size={17} aria-hidden="true" />Add visit
                    </button>
                )}
                {onAddResource && (
                    <button type="button" onClick={onAddResource}>
                        <FolderPlus size={17} aria-hidden="true" />Add resource
                    </button>
                )}
            </div>
        </section>
    );
};

export default MapActions;
