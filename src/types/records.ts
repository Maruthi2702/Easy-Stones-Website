import type { Id } from './api';

/**
 * Records as the screens receive them. Loose on purpose for now: the fields
 * named are the ones code reads, and anything else the API sends is allowed
 * through (`[key: string]: unknown`) until each screen that uses it is typed.
 */

/** A customer from /api/customers/dropdown or /list (see src/models/Customer.js). */
export type CustomerRecord = {
  _id: Id;
  company?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  location?: string;
  [key: string]: unknown;
};

/** A staff member from /api/salesreps (see src/models/User.js). */
export type StaffMember = {
  _id?: Id;
  id?: Id;
  name?: string;
  username?: string;
  displayName?: string;
  email?: string;
  role?: string;
  assignedLocations?: string[];
  [key: string]: unknown;
};

/** A location from /api/admin/locations (see src/models/Location.js). */
export type LocationRecord = {
  _id?: Id;
  name: string;
  defaultSalesRep?: string;
  [key: string]: unknown;
};

/**
 * A delivery ticket as /api/deliveries sends it (src/routes/deliveries.js
 * reshapes the model to `id`, not `_id`). Dates are 'YYYY-MM-DD'.
 */
export type DeliveryRecord = {
  id: string;
  date?: string;
  truckId?: string;
  deliveryType?: string;
  status?: string;
  location?: string;
  [key: string]: unknown;
};

/** A column on the delivery board: one driver (or 3rd party, Will Call). */
export type TruckColumn = {
  id: string;
  name: string;
  driver: string;
  color: string;
  username?: string;
  inactive?: boolean;
  location?: string;
  isContract?: boolean;
};

/** The signed-in person, as AuthContext holds them (GET /api/user/me). */
export type CurrentUser = {
  _id?: Id;
  id?: Id;
  username?: string;
  name?: string;
  displayName?: string;
  role?: string;
  permissions?: string[];
  location?: string;
  assignedLocations?: string[];
  [key: string]: unknown;
};

/**
 * A record whose fields aren't typed yet — what the API sent, read field by
 * field. The one place `any` is allowed for records: each use is a spot to
 * tighten when its screen gets a real type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = Record<string, any>;
