import type { LucideIcon } from 'lucide-react';
import type { Id } from '../../types/api';
import type { LocationRecord } from '../../types/records';

/**
 * Users & Roles' records as GET /api/admin/users and /api/admin/roles send
 * them (src/models/User.ts, Role.js). The fields named are the ones these
 * screens read; anything else passes through.
 */

/** A person on the Users list (the team view gets TEAM_USER_FIELDS only). */
export type UserRecord = {
    _id: Id;
    username: string;
    displayName?: string;
    email?: string;
    role: string;
    location?: string;
    assignedLocations?: string[];
    joiningDate?: string;
    isActive?: boolean;
    deactivatedAt?: string | null;
    loginAttempts?: number;
    lockUntil?: string | null;
    lastSeenAt?: string;
    lastLoginAt?: string;
    [key: string]: unknown;
};

/** A role, with its permission keys and (team access) the roles it may manage. */
export type RoleRecord = {
    _id: Id;
    name: string;
    displayName: string;
    isSystem?: boolean;
    permissions?: string[];
    manageableRoles?: string[];
    [key: string]: unknown;
};

/** What the account switches do (./userForm/userAccess.ts). */
export type AccessAction = 'deactivate' | 'reactivate' | 'delete';

/** One switch on a Roles & Permissions card. */
export type PermissionAction = {
    key: string;
    label: string;
    desc: string;
    icon?: LucideIcon;
    /** The card's heading this switch sits under (Users & Roles, Check In, Customers…). */
    section?: string;
    /** A switch that holds this one when on (Full access). */
    impliedBy?: string;
};

/** One card on Roles & Permissions: a page and its switches. */
export type PageDef = {
    id: string;
    page: string;
    icon: LucideIcon;
    description: string;
    color: string;
    actions: PermissionAction[];
};

/**
 * A location as Users & Roles → Locations reads it (GET /api/admin/locations,
 * the full record for someone who may manage locations; src/models/Location.ts).
 */
export type AdminLocation = LocationRecord & {
    fullName?: string;
    shortCode?: string;
    region?: string;
    rdc?: string;
    profitCenter?: boolean;
    warehouse?: boolean;
    primaryContact?: { name?: string; phone?: string; email?: string; address?: Record<string, string | undefined> };
    coordinates?: { lat?: number | null; lng?: number | null };
};
