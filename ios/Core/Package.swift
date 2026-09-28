// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "TkpstCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "TkpstCore", targets: ["TkpstCore"]),
    ],
    targets: [
        .target(name: "TkpstCore"),
        .testTarget(name: "TkpstCoreTests", dependencies: ["TkpstCore"]),
    ]
)
