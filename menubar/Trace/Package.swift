// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Trace",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "Trace",
            path: "Sources"
        ),
        .testTarget(
            name: "TraceTests",
            dependencies: ["Trace"],
            path: "Tests"
        )
    ]
)
