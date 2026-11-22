import Foundation
import Capacitor
import CoreLocation
import UIKit
import LocationHealthCore

/// Easy Surfaces' own plugin for location tracking (web side: src/features/locationCollector/locationHealthPlugin.ts).
///
///  status()                      the REAL permission level ("always" / "when-in-use" / "denied" / "unknown"), whether precise
///                                location is on, Low Power Mode, battery % and charging — what the web layer can't read.
///  startSignificantChange()      asks iOS to wake or RELAUNCH the app when the phone moves a few hundred metres, even after the
///                                person force-quit it (needs "Always"). The web layer then resumes its normal collecting.
///  stopSignificantChange()
///  queueSave / queueLoad / queueClear   the unsent points, kept in a file (not the web view's storage, which iOS may clear).
///
/// Events: "lowPowerChanged" { lowPower }, "authorizationChanged" { authorization }.
@objc(LocationHealthPlugin)
public class LocationHealthPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "LocationHealthPlugin"
    public let jsName = "LocationHealth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startSignificantChange", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSignificantChange", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queueSave", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queueLoad", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queueClear", returnType: CAPPluginReturnPromise)
    ]

    private let manager = CLLocationManager()
    private let store = PointStore.standard()
    private let wantsKey = "app.easysurfaces.significantChange"

    override public func load() {
        manager.delegate = self
        UIDevice.current.isBatteryMonitoringEnabled = true
        NotificationCenter.default.addObserver(self, selector: #selector(powerChanged), name: .NSProcessInfoPowerStateDidChange, object: nil)
        // A background relaunch for a significant change creates this plugin again: pick monitoring back up, or iOS stops waking us.
        if UserDefaults.standard.bool(forKey: wantsKey) && authorization() == "always" {
            manager.startMonitoringSignificantLocationChanges()
        }
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    @objc private func powerChanged() {
        notifyListeners("lowPowerChanged", data: ["lowPower": ProcessInfo.processInfo.isLowPowerModeEnabled])
    }

    private func authorization() -> String { authorizationName(manager.authorizationStatus) }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        notifyListeners("authorizationChanged", data: ["authorization": authorization()])
    }

    // We only want the wake-up, not the position: the web layer's own watcher records points. Nothing to do here.
    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {}
    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

    @objc func status(_ call: CAPPluginCall) {
        let level = batteryPercent(UIDevice.current.batteryLevel)
        let state = UIDevice.current.batteryState
        call.resolve([
            "authorization": authorization(),
            "precise": manager.accuracyAuthorization == .fullAccuracy,
            "lowPower": ProcessInfo.processInfo.isLowPowerModeEnabled,
            "batteryPct": level as Any,
            "charging": state == .charging || state == .full,
            "significantChange": UserDefaults.standard.bool(forKey: wantsKey)
        ])
    }

    @objc func startSignificantChange(_ call: CAPPluginCall) {
        guard CLLocationManager.significantLocationChangeMonitoringAvailable() else { call.resolve(["started": false, "reason": "unavailable"]); return }
        UserDefaults.standard.set(true, forKey: wantsKey)
        DispatchQueue.main.async {
            // Without "Always" iOS won't relaunch a terminated app; we keep the wish so it starts the moment "Always" is granted.
            if self.authorization() == "always" { self.manager.startMonitoringSignificantLocationChanges() }
            call.resolve(["started": self.authorization() == "always", "authorization": self.authorization()])
        }
    }

    @objc func stopSignificantChange(_ call: CAPPluginCall) {
        UserDefaults.standard.set(false, forKey: wantsKey)
        DispatchQueue.main.async { self.manager.stopMonitoringSignificantLocationChanges(); call.resolve() }
    }

    @objc func queueSave(_ call: CAPPluginCall) {
        guard let userId = call.getString("userId"), !userId.isEmpty else { call.reject("userId is required"); return }
        let points = (call.getArray("points") as? [[String: Any]]) ?? []
        call.resolve(["saved": store.save(userId: userId, points: points), "count": points.count])
    }

    @objc func queueLoad(_ call: CAPPluginCall) {
        guard let userId = call.getString("userId"), !userId.isEmpty else { call.reject("userId is required"); return }
        call.resolve(["points": store.load(userId: userId)])
    }

    @objc func queueClear(_ call: CAPPluginCall) {
        store.clearAll()
        call.resolve()
    }
}
