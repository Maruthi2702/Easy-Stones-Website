import { useState } from 'react';
import type { PlannerItem } from '../plannerSchedule';
import { customerIdOfStop, mapsAppsHere, MAPS_APP_LABELS, openDirections, readMapsApp, saveMapsApp, type MapsApp } from '../directions';
import './MapsAppRow.css';

/**
 * "Open in" under a stop's Directions: Google Maps, Apple Maps (Apple devices only) or Waze. The
 * app a rep taps is remembered on this device and is what Directions opens from then on; tapping
 * one opens the directions in it at once.
 */
export default function MapsAppRow({ item, onDone }: { item: PlannerItem; onDone: () => void }) {
    const [current, setCurrent] = useState<MapsApp>(() => readMapsApp());
    const customerId = customerIdOfStop(item);
    if (!customerId) return null;
    const choose = (app: MapsApp) => {
        saveMapsApp(app);
        setCurrent(app);
        onDone();
        void openDirections(customerId, app);
    };
    return (
        <div className="pl-mapsapp" role="group" aria-label="Open directions in">
            <span className="pl-mapsapp-label">Open in</span>
            {mapsAppsHere().map((app) => (
                <button key={app} type="button" className={`pl-mapsapp-btn${app === current ? ' is-on' : ''}`} aria-pressed={app === current} onClick={() => choose(app)}>
                    {MAPS_APP_LABELS[app]}
                </button>
            ))}
        </div>
    );
}
