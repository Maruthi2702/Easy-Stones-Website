package app.easysurfaces.locationhealth;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;

/**
 * Easy Surfaces' own plugin for location tracking on Android (the iOS twin is LocationHealthPlugin.swift; the web side is
 * src/features/locationCollector/locationHealthPlugin.ts). Same methods and the same answers, so the web code does not care
 * which phone it is on.
 *
 *  status()                       the REAL permission level ("always" = fine location AND "Allow all the time", "when-in-use",
 *                                 or "unknown" when location was never allowed), whether precise location is on, Battery saver
 *                                 (reported as lowPower), battery % and charging.
 *  requestAlways()                the separate "Allow all the time" step Android 10+ needs after location is allowed.
 *  startSignificantChange()       iOS only: on Android the foreground service of the background-geolocation plugin keeps the
 *                                 collector alive, so this answers { started: false, reason: "not-applicable" }.
 *  queueSave / queueLoad / queueClear   the unsent points, kept in a file (not the web view's storage).
 *  openBatterySettings()          Android phone makers (Samsung, Xiaomi, Huawei…) stop background apps to save battery; this
 *                                 opens the list where the app can be set to "Unrestricted".
 */
@CapacitorPlugin(
    name = "LocationHealth",
    permissions = {
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, alias = "location"),
        @Permission(strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }, alias = "background")
    }
)
public class LocationHealthPlugin extends Plugin {
    private PointStore store;

    @Override
    public void load() {
        store = new PointStore(new java.io.File(getContext().getFilesDir(), "LocationQueue"));
    }

    private boolean granted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    private String authorization() {
        boolean fine = granted(Manifest.permission.ACCESS_FINE_LOCATION);
        boolean coarse = granted(Manifest.permission.ACCESS_COARSE_LOCATION);
        if (!fine && !coarse) return "unknown";
        // Before Android 10 there is no separate background permission: allowed means allowed.
        boolean background = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION);
        return background ? "always" : "when-in-use";
    }

    /** Battery % (0–100) or null when the phone cannot say. */
    private Integer batteryPercent(Intent battery) {
        if (battery == null) return null;
        int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
        if (level < 0 || scale <= 0) return null;
        return Math.round(level * 100f / scale);
    }

    @PluginMethod
    public void status(PluginCall call) {
        Context context = getContext();
        Intent battery = context.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        int plugged = battery == null ? 0 : battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
        int state = battery == null ? -1 : battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        JSObject result = new JSObject();
        result.put("authorization", authorization());
        result.put("precise", granted(Manifest.permission.ACCESS_FINE_LOCATION));
        result.put("lowPower", power != null && power.isPowerSaveMode());
        Integer pct = batteryPercent(battery);
        if (pct == null) result.put("batteryPct", JSObject.NULL); else result.put("batteryPct", pct);
        result.put("charging", plugged != 0 || state == BatteryManager.BATTERY_STATUS_CHARGING || state == BatteryManager.BATTERY_STATUS_FULL);
        result.put("significantChange", false);
        PowerManager pm = power;
        boolean unrestricted = pm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && pm.isIgnoringBatteryOptimizations(context.getPackageName());
        result.put("batteryUnrestricted", unrestricted);
        call.resolve(result);
    }

    @PluginMethod
    public void requestAlways(PluginCall call) {
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION) && !granted(Manifest.permission.ACCESS_COARSE_LOCATION)) {
            // Android refuses the background step until location itself is allowed: ask for that first.
            requestPermissionForAlias("location", call, "locationCallback");
            return;
        }
        askBackground(call);
    }

    @PermissionCallback
    private void locationCallback(PluginCall call) {
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION) && !granted(Manifest.permission.ACCESS_COARSE_LOCATION)) {
            JSObject r = new JSObject(); r.put("authorization", authorization()); call.resolve(r); return;
        }
        askBackground(call);
    }

    private void askBackground(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {
            JSObject r = new JSObject(); r.put("authorization", authorization()); call.resolve(r); return;
        }
        // Android 11+ opens the app's location settings page for this one; the person picks "Allow all the time".
        requestPermissionForAlias("background", call, "backgroundCallback");
    }

    @PermissionCallback
    private void backgroundCallback(PluginCall call) {
        JSObject r = new JSObject(); r.put("authorization", authorization()); call.resolve(r);
    }

    @PluginMethod
    public void startSignificantChange(PluginCall call) {
        JSObject r = new JSObject(); r.put("started", false); r.put("reason", "not-applicable"); r.put("authorization", authorization());
        call.resolve(r);
    }

    @PluginMethod
    public void stopSignificantChange(PluginCall call) { call.resolve(); }

    @PluginMethod
    public void queueSave(PluginCall call) {
        String userId = call.getString("userId");
        if (userId == null || userId.isEmpty()) { call.reject("userId is required"); return; }
        JSArray points = call.getArray("points", new JSArray());
        JSObject r = new JSObject();
        boolean saved;
        try { saved = store.save(userId, new JSONArray(points.toString())); } catch (Exception e) { saved = false; }
        r.put("saved", saved);
        r.put("count", points.length());
        call.resolve(r);
    }

    @PluginMethod
    public void queueLoad(PluginCall call) {
        String userId = call.getString("userId");
        if (userId == null || userId.isEmpty()) { call.reject("userId is required"); return; }
        JSObject r = new JSObject();
        try { r.put("points", new JSArray(store.load(userId).toString())); } catch (Exception e) { r.put("points", new JSArray()); }
        call.resolve(r);
    }

    @PluginMethod
    public void queueClear(PluginCall call) { store.clearAll(); call.resolve(); }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { getContext().startActivity(intent); call.resolve(); }
        catch (Exception e) { call.reject("Couldn’t open the battery settings."); }
    }
}
