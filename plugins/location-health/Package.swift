// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LocationHealth",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "LocationHealth", targets: ["LocationHealthPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        // Foundation-only: the queue file and the wording of a permission. Tested on a Mac with `swift test`.
        .target(name: "LocationHealthCore", path: "ios/Sources/LocationHealthCore"),
        .target(
            name: "LocationHealthPlugin",
            dependencies: [
                "LocationHealthCore",
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/LocationHealthPlugin"),
        .testTarget(name: "LocationHealthCoreTests", dependencies: ["LocationHealthCore"], path: "ios/Tests/LocationHealthCoreTests")
    ]
)
