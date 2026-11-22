import Foundation

/// The phone's unsent location points, kept in a file so they survive the app being killed, the web view's storage being
/// cleared, and a restart (the web layer's localStorage can be evicted under memory pressure). One file per person, so a
/// different login on the same phone never sees or sends someone else's points. Points are opaque JSON objects the web
/// layer owns; this only stores them. The file is written atomically, and is readable once the phone has been unlocked
/// once after a restart (`completeUntilFirstUserAuthentication`), which a background launch needs.
public final class PointStore {
    private let directory: URL
    private let queue = DispatchQueue(label: "app.easysurfaces.pointstore")

    public init(directory: URL) {
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// The default place: Application Support (never backed up to iCloud by us, never purged like Caches).
    public static func standard() -> PointStore {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return PointStore(directory: base.appendingPathComponent("LocationQueue", isDirectory: true))
    }

    /// A user id becomes a safe file name: letters, digits, dash and underscore only.
    static func fileName(for userId: String) -> String {
        let safe = String(userId.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" ? Character($0) : "_" })
        return "points-\(safe.prefix(64)).json"
    }

    private func url(_ userId: String) -> URL { directory.appendingPathComponent(PointStore.fileName(for: userId)) }

    /// Replaces this person's queue with `points` (an array of JSON objects). An empty list removes the file.
    @discardableResult
    public func save(userId: String, points: [[String: Any]]) -> Bool {
        queue.sync {
            let file = url(userId)
            if points.isEmpty { try? FileManager.default.removeItem(at: file); return true }
            guard JSONSerialization.isValidJSONObject(points), let data = try? JSONSerialization.data(withJSONObject: points) else { return false }
            do {
                #if os(iOS)
                try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                #else
                try data.write(to: file, options: [.atomic])
                #endif
                return true
            } catch { return false }
        }
    }

    /// This person's saved points, oldest first; an unreadable or missing file is an empty queue, never a crash.
    public func load(userId: String) -> [[String: Any]] {
        queue.sync {
            guard let data = try? Data(contentsOf: url(userId)),
                  let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
            return list
        }
    }

    /// Removes every person's file (sign-out of the last person, or a reset).
    public func clearAll() {
        queue.sync {
            let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
            for f in files where f.lastPathComponent.hasPrefix("points-") { try? FileManager.default.removeItem(at: f) }
        }
    }
}
