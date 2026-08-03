// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Brainch",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "Brainch",
            path: "Sources"
        ),
        .testTarget(
            name: "BrainchTests",
            dependencies: ["Brainch"],
            path: "Tests"
        )
    ]
)
