/**
 * What the accounts saves (accounts.ts) take and answer — shared by both twins, so
 * this sits apart from the picker (which imports them).
 */
import type { Loose } from '../../../types/records.ts';

/** A contact as POST /contacts builds it (createdBy isn't on the schema; MongoDB drops it). */
export interface NewContact {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  role?: unknown;
  notes?: unknown;
  createdAt: string;
  createdBy?: string;
}

/** PUT /contacts/:contactId's body: every key is set on the contact. */
export type ContactFields = Loose;

export interface RegisterInput {
  contactName: unknown;
  email: unknown;
  password: unknown;
  phone: unknown;
  company: unknown;
}

export interface RegisteredCustomer { _id: string; contactName: string; email: string }

export interface PasswordReset { id: string; contactName: string; email: string }

/** The customer an email signs in as, with the lock rules the login route calls. */
export interface CustomerSignIn {
  _id: unknown;
  contactName: string;
  email: string;
  company?: string | null;
  role?: string;
  isActive?: boolean;
  isLocked(): boolean;
  comparePassword(candidatePassword: string): Promise<boolean>;
  incLoginAttempts(): PromiseLike<unknown>;
}

export interface CustomerAccount {
  _id: unknown;
  contactName: string;
  email: string;
  company?: string | null;
  role?: string;
}

export interface GeocodeCandidate {
  _id: string;
  address?: Loose | null;
  geocode?: Loose | null;
}

/** geocodeAddress()'s answer (src/utils/geocode.ts). */
export interface GeocodeResult {
  coordinates: { lat: number | null; lng: number | null };
  geocode: { status: string; precision: string; formattedAddress: string; addressKey: string; updatedAt: Date; error: unknown };
}
