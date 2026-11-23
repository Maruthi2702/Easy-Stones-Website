package app.easysurfaces.locationhealth;

import org.json.JSONArray;

import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * The phone's unsent location points, kept in a file so they survive the app being killed and the web view's storage
 * being cleared (the iOS twin is PointStore.swift). One file per person, so a different login on the same phone never sees
 * or sends someone else's points. Points are opaque JSON objects the web layer owns; this only stores them. Written to a
 * temp file and renamed, so a crash mid-write never leaves half a file. A missing or unreadable file is an empty queue.
 */
public final class PointStore {
    private final File directory;

    public PointStore(File directory) {
        this.directory = directory;
        //noinspection ResultOfMethodCallIgnored
        directory.mkdirs();
    }

    /** A user id becomes a safe file name: letters, digits, dash and underscore only, 64 at most. */
    static String fileName(String userId) {
        StringBuilder safe = new StringBuilder();
        for (int i = 0; i < userId.length() && safe.length() < 64; i++) {
            char c = userId.charAt(i);
            safe.append(Character.isLetterOrDigit(c) || c == '-' || c == '_' ? c : '_');
        }
        return "points-" + safe + ".json";
    }

    private File file(String userId) { return new File(directory, fileName(userId)); }

    /** Replaces this person's queue with `points`. An empty list removes the file. */
    public synchronized boolean save(String userId, JSONArray points) {
        File target = file(userId);
        if (points == null || points.length() == 0) { //noinspection ResultOfMethodCallIgnored
            target.delete(); return true; }
        File temp = new File(directory, target.getName() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(temp)) {
            out.write(points.toString().getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (Exception e) { return false; }
        return temp.renameTo(target);
    }

    /** This person's saved points, oldest first; never throws. */
    public synchronized JSONArray load(String userId) {
        File source = file(userId);
        if (!source.exists()) return new JSONArray();
        try (FileInputStream in = new FileInputStream(source); ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[8192];
            int n;
            while ((n = in.read(chunk)) > 0) buffer.write(chunk, 0, n);
            return new JSONArray(new String(buffer.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception e) { return new JSONArray(); }
    }

    /** Removes every person's queue (sign-out on a shared phone). */
    public synchronized void clearAll() {
        File[] files = directory.listFiles();
        if (files == null) return;
        for (File f : files) //noinspection ResultOfMethodCallIgnored
            f.delete();
    }
}
