import React from 'react';
import { Marker } from '@react-google-maps/api';
import { nameOf, isNotInterested } from '../helpers';
import { insideBounds } from './mapGeometry';
import type { Bounds } from './mapGeometry';
import type { MapPin as Customer } from '../types';

/**
 * Every customer pin. Its own memoised component so the map's other state (the
 * lasso's live count, an open panel, the "You" dot, the route line) re-renders
 * MapCanvas without handing 1,000-5,000 markers new props and redrawing them.
 * Route stops always draw; the rest only while inside the padded viewport.
 */
export type PinLayerProps = {
    selectedPins: Customer[];
    unselectedPins: Customer[];
    orderById: Map<string, number>;
    openId: string | undefined;
    bounds: Bounds | null;
    iconFor: (pin: Customer, order: number | undefined, isOpen?: boolean) => google.maps.Icon | undefined;
    onSelect: (pin: Customer) => void;
};
const PinLayer = React.memo(({ selectedPins, unselectedPins, orderById, openId, bounds, iconFor, onSelect }: PinLayerProps) => {
    // No bounds yet = the map hasn't settled on its first view: draw none rather than all of them.
    const shown = bounds ? unselectedPins.filter((p) => insideBounds(bounds, p.coordinates)) : [];
    return (
        <>
            {selectedPins.map((pin) => (
                <Marker
                    key={pin._id}
                    position={pin.coordinates}
                    icon={iconFor(pin, orderById.get(pin._id), openId === pin._id)}
                    title={`${nameOf(pin)} — ${pin.recency.label}`}
                    opacity={isNotInterested(pin) && openId !== pin._id ? 0.4 : 1}
                    onClick={() => onSelect(pin)}
                />
            ))}
            {/* Every other customer, always its own clickable pin — no cluster
                badge standing in for several of them, so a rep can open or
                lasso/radius-select any individual customer. */}
            {shown.map((pin) => (
                <Marker
                    key={pin._id}
                    position={pin.coordinates}
                    icon={iconFor(pin, undefined, openId === pin._id)}
                    title={`${nameOf(pin)} — ${pin.recency.label}`}
                    opacity={isNotInterested(pin) && openId !== pin._id ? 0.4 : 1}
                    onClick={() => onSelect(pin)}
                />
            ))}
        </>
    );
});

export default PinLayer;
