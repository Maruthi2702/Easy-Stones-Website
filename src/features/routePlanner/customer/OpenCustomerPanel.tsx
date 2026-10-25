import { CustomerDrawer } from '../../customers';
import { canViewCustomerProfile } from '../../../utils/customerAccess';
import { visitRecency } from '../helpers';
import MapActions from './MapActions';
import type { CurrentUser, Loose } from '../../../types/records';
import type { Booking, DayStop, MapPin as Customer, Pin, PlannerPermissions, RecencyColors, ReturnPanel } from '../types';

export type OpenCustomerPanelProps = {
    info: Customer;
    /** The day being planned: the arrows step through its stops when the customer is on it. */
    day: DayStop[];
    pinById: Map<string, Pin>;
    returnPanel: ReturnPanel;
    showDetails: (customer: Customer, origin?: ReturnPanel) => void;
    onClose: () => void;
    currentUser: CurrentUser | null;
    onOpenCustomer: ((id: string) => void) | null;
    onEdit: (customer: Loose) => void;
    onDelete: (customer: Customer) => void;
    onStatusChange: (id: string, status: string) => Promise<boolean>;
    can: PlannerPermissions;
    colors: RecencyColors;
    booking: Booking | null;
    saving: boolean;
    onSchedule: (customer: Customer) => void;
    onRemove: (customer: Customer) => void;
    onAddVisit: ((pin: Customer) => void) | null;
    onAddResource: ((pin: Customer) => void) | null;
};

/**
 * The open customer: the Customers tab's own panel (so it changes with
 * that), plus what the map adds under the header. When the customer is on
 * the day being planned, the arrows step through that day's stops;
 * otherwise it's just this one customer.
 */
const OpenCustomerPanel = ({
    info, day, pinById, returnPanel, showDetails, onClose, currentUser, onOpenCustomer,
    onEdit, onDelete, onStatusChange, can, colors, booking, saving, onSchedule, onRemove, onAddVisit, onAddResource
}: OpenCustomerPanelProps) => {
    const stopIndex = day.findIndex(stop => String(stop._id) === String(info._id));
    const onRoute = stopIndex >= 0 && day.length > 1;
    const goStop = (i: number) => {
        const pin = pinById.get(String(day[i]?._id));
        if (pin) showDetails({ ...pin, recency: visitRecency(pin.lastVisitAt) }, returnPanel);
    };
    const canProfile = canViewCustomerProfile(currentUser);
    return (
        <CustomerDrawer
            key={String(info._id)}
            className="rpv2-host"
            customer={info}
            overlay={false}
            position={onRoute ? { index: stopIndex, total: day.length } : null}
            onPrev={onRoute && stopIndex > 0 ? () => goStop(stopIndex - 1) : null}
            onNext={onRoute && stopIndex < day.length - 1 ? () => goStop(stopIndex + 1) : null}
            onClose={onClose}
            onOpenProfile={(c) => { onOpenCustomer?.(c._id); onClose(); }}
            onEdit={(c) => onEdit(c)}
            onDelete={() => onDelete(info)}
            onStatusChange={onStatusChange}
            canEdit={can.manageCustomers}
            canDelete={can.deleteCustomers}
            canProfile={canProfile && Boolean(onOpenCustomer)}
            mapSection={(
                <MapActions
                    pin={info}
                    colors={colors}
                    stop={day.find(stop => String(stop._id) === String(info._id)) || null}
                    booking={booking}
                    canPlan={can.plan}
                    saving={saving}
                    onSchedule={() => onSchedule(info)}
                    onRemove={() => onRemove(info)}
                    onAddVisit={onAddVisit ? () => onAddVisit(info) : null}
                    onAddResource={onAddResource ? () => onAddResource(info) : null}
                />
            )}
        />
    );
};

export default OpenCustomerPanel;
