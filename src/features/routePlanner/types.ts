import type { Loose } from '../../types/records';

/** A point on the map. */
export type LatLng = { lat: number; lng: number };

/** The four visit-age buckets (RECENCY_BUCKETS in src/utils/routePlan.ts). */
export type RecencyKey = 'never' | 'overdue' | 'due' | 'recent';
/** How long since the last visit (visitRecency in src/utils/routePlan.ts). */
export type Recency = { key: RecencyKey; days: number | null; label: string };
/** One visit-age bucket as the Filter lists it. */
export type RecencyBucket = { key: RecencyKey; label: string; minDays: number };
/** A colour per visit-age bucket (RECENCY_COLORS in helpers.ts). */
export type RecencyColors = Record<RecencyKey, string>;

/**
 * A customer as GET /api/customers/map sends it — a slim pin
 * (src/routes/customerMap.ts). Opening one adds its contact details; the rest
 * is read loosely until the customer record has a real type.
 */
export type Pin = Loose & {
    _id: string;
    company?: string;
    contactName?: string;
    city?: string;
    coordinates: LatLng;
    salesRep?: string | null;
    salesRepName?: string;
    customerType?: string;
    status?: string;
    lastVisitAt?: string;
};
/** A pin with its visit age worked out (what the map, lists and panel read). */
export type MapPin = Pin & { recency: Recency };

/** One stop on the day being planned (planDay in src/utils/routePlan.ts). */
export type DayStop = MapPin & { order: number; startTime: string; endTime: string; milesFromPrevious: number; minutesFromPrevious?: number };
/** The day's totals (daySummary in src/utils/routePlan.ts). */
export type DaySummary = { stops: number; miles: number; drivingMinutes: number; endsAt: string | null };

/** A schedule entry from GET /api/schedule (the customer populated to a name). */
export type ScheduleRow = Loose & {
    _id: string;
    startTime: string;
    endTime?: string;
    activityType?: string;
    status?: string;
    notes?: string;
    source?: string;
    customerId?: string | { _id: string; company?: string; contactName?: string } | null;
};
/** A customer's next entry on the calendar (the panel's "Scheduled …"). */
export type Booking = { id: string; startTime: string };

/** What the Tools panel's last save did, for its "N stops added" line. */
export type SavedDay = { count: number; replaced?: number; cleared?: number; date: string };

/** A business found by "Find new leads" (Google Places), not a customer yet. */
export type Lead = {
    placeId: string;
    name: string;
    address: string;
    phone: string;
    types: string[];
    coordinates: LatLng;
    addressParts: { street: string; city: string; state: string; zipCode: string };
};

/** Which draw gesture is armed in the Tools panel. */
export type DrawMode = 'radius' | 'lasso' | null;
/** The boundary that made the current selection, kept drawn on the map. */
export type SelectionShape =
    | { type: 'radius'; center: LatLng; radiusMeters: number }
    | { type: 'lasso'; path: LatLng[] };

/** A panel the customer panel replaced, brought back when it closes. */
export type ReturnPanel = 'tools' | 'customers' | 'schedule' | null;

/** What this login may do here. */
export type PlannerPermissions = {
    plan: boolean;
    replace: boolean;
    clear: boolean;
    manageCustomers: boolean;
    deleteCustomers: boolean;
};

/** A row in the Filter's rep list: Unassigned, or a rep under their branch heading. */
export type RepOption = { key: string; label: string; group: string | null };
/** On/off per key (a rep id, a customer type, a visit-age bucket). */
export type Toggles = Record<string, boolean>;
/** What the pins' colour means. */
export type ColorMode = 'type' | 'visit';

/** "Plan route" from the Customers list: these customers become the selection. */
export type Preselect = { ids: string[]; nonce: unknown } | null;

/** The form ScheduleActivityForm sends: a new entry or an edit of one. */
/** What the Schedule panel's add / edit form saves. `id` is a new entry's own id, so a repeated send books once. */
export type ScheduleVisitInput = { customerId: string; startTime: string; endTime: string; activityType: string; notes: string; id?: string };
/** What ScheduleVisitSheet saves: a new booking, or the customer's existing one moved. */
export type VisitSlotInput = {
    customer: MapPin; booking: Booking | null; date: string; startTime: string; endTime: string;
    activityType: string; notes: string;
    /** The new entry's own id, so a repeated send books once. */
    id?: string;
};
