import * as Application from 'expo-application';
import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import type { DeviceState } from '../../../src/features/locationCollector/collectorRules';

/** The real permission level: "always" (background allowed), "when-in-use", "denied" (asked and refused), or "unknown" (never asked). */
export async function authorization(): Promise<DeviceState['permission']> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return fg.canAskAgain ? 'unknown' : 'denied';
  return (await Location.getBackgroundPermissionsAsync()).granted ? 'always' : 'when-in-use';
}

/** What the phone says about itself (the heartbeat's body). */
export async function readDeviceState(): Promise<DeviceState> {
  const [permission, level, state, low] = await Promise.all([
    authorization().catch(() => 'unknown' as const), Battery.getBatteryLevelAsync().catch(() => -1),
    Battery.getBatteryStateAsync().catch(() => Battery.BatteryState.UNKNOWN), Battery.isLowPowerModeEnabledAsync().catch(() => false)
  ]);
  return {
    permission, lowPower: low, batteryPct: level >= 0 ? Math.round(level * 100) : null,
    charging: state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL,
    appVersion: `${Application.nativeApplicationVersion || ''}${Application.nativeBuildVersion ? `+${Application.nativeBuildVersion}` : ''}`
  };
}
