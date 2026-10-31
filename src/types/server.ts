import type { RequestHandler } from 'express';
import type { Loose } from './records.ts';

/** The staff/session fields attached by authentication before API handlers run. */
export type StaffPrincipal = {
  id?: string;
  username?: string;
  displayName?: string;
  contactName?: string;
  role?: string;
  location?: string;
  assignedLocations?: string[];
  permissions: string[];
};

export type PermissionMiddleware = (permission: string) => RequestHandler;
export type AnyPermissionMiddleware = (...permissions: string[]) => RequestHandler;
export type PublishEvent = (event: string, payload?: unknown) => void;

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
    teamScope?: { manageableRoles: string[] } | null;
    /** Multipart/SPS request details are validated by the owning route. */
    importContext?: Loose;
  }
}
