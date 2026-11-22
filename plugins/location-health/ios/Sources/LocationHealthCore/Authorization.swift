import Foundation
import CoreLocation

/// What the web layer is told about location permission: one of "always", "when-in-use", "denied", "unknown".
/// "when-in-use" is the one that matters most: iOS then stops delivering locations once the app is closed, so a
/// manager must be told that is why a person went quiet. "unknown" = not asked yet.
public func authorizationName(_ status: CLAuthorizationStatus) -> String {
    switch status {
    case .authorizedAlways: return "always"
    case .authorizedWhenInUse: return "when-in-use"
    case .denied, .restricted: return "denied"
    case .notDetermined: return "unknown"
    @unknown default: return "unknown"
    }
}

/// A battery level from UIDevice (0.0–1.0, or -1 when unknown) as a whole percent, or nil when the phone can't say.
public func batteryPercent(_ level: Float) -> Int? {
    guard level >= 0 && level <= 1 else { return nil }
    return Int((level * 100).rounded())
}
