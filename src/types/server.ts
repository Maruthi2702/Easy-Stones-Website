import type { RequestHandler } from 'express';
import type { Types } from 'mongoose';
import type { UserData } from '../models/User.ts';

/** Only the fields selected by the authentication aggregation, never secrets. */
export type AuthenticatedStaffDocument = Pick<UserData,
  'username' | 'displayName' | 'email' | 'role' | 'assignedLocations' |
  'location' | 'routePlannerFilters' | 'pinnedTabs' | 'isActive' |
  'mustChangePassword' | 'sessionVersion'
> & { _id: Types.ObjectId; permissions: string[] };

/** The staff/session fields attached by authentication before API handlers run. */
export type StaffPrincipal = {
  id?: string;
  username?: string;
  displayName?: string;
  contactName?: string;
  name?: string;
  email?: string;
  type?: string;
  role?: string;
  location?: string;
  assignedLocations?: string[];
  permissions: string[];
  [key: string]: unknown;
};

export type PermissionMiddleware = (permission: string) => RequestHandler;
export type AnyPermissionMiddleware = (...permissions: string[]) => RequestHandler;
export type PublishEvent = (event: string, payload?: unknown) => void;

// Legacy scalar controllers validate these contracts at their route boundary
// with src/server/scalarRequest.ts. Array-aware endpoints use their own schemas.
export type ScalarQuery = Record<string, string | undefined>;
export type ScalarParams = Record<string, string>;

declare module 'express-serve-static-core' {
  interface Request {
    user: StaffPrincipal;
    userId?: string;
    customerId?: string;
    authType?: 'admin' | 'customer';
    accountType?: string;
    userRole?: string;
    authUserDoc?: AuthenticatedStaffDocument;
    tokenClaims?: import('jsonwebtoken').JwtPayload;
    podOnly?: boolean;
    teamScope?: { manageableRoles: string[] } | null;
    /** Multipart/SPS request details are validated by the owning route. */
    importContext?: Record<string, unknown>;
  }
}
