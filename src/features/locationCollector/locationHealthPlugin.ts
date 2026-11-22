import { registerPlugin } from '@capacitor/core';
import type { RawPoint } from '../../utils/locationTracking';

/**
 * Easy Surfaces' own iOS plugin (plugins/location-health, Swift). It is only in app builds made after 2026-11-22: this web
 * code is also loaded by older builds (the app shows the live site), where every call rejects as "not implemented".
 * Callers in backgroundLocation.ts guard each one, so an old build simply behaves as it did before.
 */
export type NativeStatus = {
  /** What iOS location permission really is: "always", "when-in-use", "denied" or "unknown" (not asked yet). */
  authorization: 'always' | 'when-in-use' | 'denied' | 'unknown';
  precise: boolean;
  lowPower: boolean;
  batteryPct: number | null;
  charging: boolean;
  significantChange: boolean;
};

export interface LocationHealthPlugin {
  status(): Promise<NativeStatus>;
  /** Asks iOS to wake or relaunch the app when the phone moves a few hundred metres (needs "Always"). */
  startSignificantChange(): Promise<{ started: boolean; authorization?: string; reason?: string }>;
  stopSignificantChange(): Promise<void>;
  /** The unsent points, kept in a file on the phone. */
  queueSave(options: { userId: string; points: RawPoint[] }): Promise<{ saved: boolean; count: number }>;
  queueLoad(options: { userId: string }): Promise<{ points: RawPoint[] }>;
  queueClear(): Promise<void>;
}

export const LocationHealth = registerPlugin<LocationHealthPlugin>('LocationHealth');
