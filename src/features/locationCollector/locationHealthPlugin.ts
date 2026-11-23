import { registerPlugin } from '@capacitor/core';
import type { RawPoint } from '../../utils/locationTracking';

/**
 * Easy Surfaces' own plugin (plugins/location-health: Swift on iPhone, Java on Android; same methods). It is only in app builds made after 2026-11-22: this web
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
  /** Android only: is the app exempt from the phone's battery optimisation (set to "Unrestricted")? */
  batteryUnrestricted?: boolean;
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
  /** Android only: the separate "Allow all the time" step, after location itself is allowed. */
  requestAlways(): Promise<{ authorization: NativeStatus['authorization'] }>;
  /** Android only: opens the list where the app can be set to "Unrestricted" battery use. */
  openBatterySettings(): Promise<void>;
  /**
   * React Native app only (mobile/): the PHONE collects and sends this person's location itself (mobile/src/collector), so tracking does not
   * depend on this page staying alive in the background. The page keeps consent and the pill.
   */
  startCollecting(options: { userId: string }): Promise<{ started: boolean; denied: boolean }>;
  stopCollecting(): Promise<void>;
  /** `native: true` = the phone collects, so this page must not. `denied`: the person refused or revoked location. */
  collectorState(): Promise<{ native: boolean; enabled: boolean; running: boolean; queued: number; denied: boolean }>;
}

export const LocationHealth = registerPlugin<LocationHealthPlugin>('LocationHealth');
