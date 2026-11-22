import XCTest
import CoreLocation
@testable import LocationHealthCore

final class CoreTests: XCTestCase {
    func tempStore() -> (PointStore, URL) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("lh-\(UUID().uuidString)")
        return (PointStore(directory: dir), dir)
    }
    let pts: [[String: Any]] = [["id": "1-a", "lat": 47.6, "lng": -122.3, "at": "2026-11-18T20:00:00.000Z"], ["id": "2-b", "lat": 47.7, "lng": -122.3, "at": "2026-11-18T20:01:00.000Z"]]

    func testSavesAndLoadsInOrder() {
        let (s, dir) = tempStore(); defer { try? FileManager.default.removeItem(at: dir) }
        XCTAssertTrue(s.save(userId: "u1", points: pts))
        let back = s.load(userId: "u1")
        XCTAssertEqual(back.map { $0["id"] as? String }, ["1-a", "2-b"])
        XCTAssertEqual(back[0]["lat"] as? Double, 47.6)
    }
    func testSurvivesANewStoreOnTheSameFolder() {   // the app was killed and relaunched
        let (s, dir) = tempStore(); defer { try? FileManager.default.removeItem(at: dir) }
        s.save(userId: "u1", points: pts)
        XCTAssertEqual(PointStore(directory: dir).load(userId: "u1").count, 2)
    }
    func testOnePersonNeverSeesAnothers() {
        let (s, dir) = tempStore(); defer { try? FileManager.default.removeItem(at: dir) }
        s.save(userId: "u1", points: pts)
        XCTAssertEqual(s.load(userId: "u2").count, 0)
        s.save(userId: "u2", points: [pts[0]])
        XCTAssertEqual(s.load(userId: "u1").count, 2)
        XCTAssertEqual(s.load(userId: "u2").count, 1)
    }
    func testSaveReplacesAndEmptyRemoves() {
        let (s, dir) = tempStore(); defer { try? FileManager.default.removeItem(at: dir) }
        s.save(userId: "u1", points: pts)
        s.save(userId: "u1", points: [pts[1]])
        XCTAssertEqual(s.load(userId: "u1").count, 1)
        s.save(userId: "u1", points: [])
        XCTAssertEqual(s.load(userId: "u1").count, 0)
    }
    func testACorruptFileIsAnEmptyQueueNotACrash() {
        let (s, dir) = tempStore(); defer { try? FileManager.default.removeItem(at: dir) }
        try? "not json".write(to: dir.appendingPathComponent(PointStore.fileName(for: "u1")), atomically: true, encoding: .utf8)
        XCTAssertEqual(s.load(userId: "u1").count, 0)
        XCTAssertTrue(s.save(userId: "u1", points: pts))   // and it can be written over
    }
    func testAnUnsafeUserIdCannotEscapeTheFolder() {
        XCTAssertEqual(PointStore.fileName(for: "../../etc/passwd"), "points-______etc_passwd.json")
        XCTAssertFalse(PointStore.fileName(for: "a/b").contains("/"))
    }
    func testClearAll() {
        let (s, dir) = tempStore(); defer { try? FileManager.default.removeItem(at: dir) }
        s.save(userId: "u1", points: pts); s.save(userId: "u2", points: pts)
        s.clearAll()
        XCTAssertEqual(s.load(userId: "u1").count + s.load(userId: "u2").count, 0)
    }
    func testWordsForPermissionAndBattery() {
        XCTAssertEqual(authorizationName(.authorizedAlways), "always")
        XCTAssertEqual(authorizationName(.authorizedWhenInUse), "when-in-use")
        XCTAssertEqual(authorizationName(.denied), "denied")
        XCTAssertEqual(authorizationName(.restricted), "denied")
        XCTAssertEqual(authorizationName(.notDetermined), "unknown")
        XCTAssertEqual(batteryPercent(0.426), 43)
        XCTAssertNil(batteryPercent(-1))
        XCTAssertNil(batteryPercent(1.5))
    }
}
