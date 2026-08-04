import SwiftUI

@MainActor
final class BrowserCaptureStore: ObservableObject {
    @Published private(set) var enabled: Bool
    @Published private(set) var authorized = false
    @Published private(set) var status = "Paused"

    private var pollTask: Task<Void, Never>?
    private static let defaultsKey = "trace.browserCapture.enabled"

    init() {
        enabled = UserDefaults.standard.bool(forKey: Self.defaultsKey)
        status = enabled ? "Waiting for Chrome extension" : "Paused"
        startPolling()
        Task { try? await APIClient.shared.setCapturePolicy(enabled: enabled) }
    }

    deinit { pollTask?.cancel() }

    func setEnabled(_ value: Bool) {
        enabled = value
        status = value ? "Waiting for Chrome extension" : "Paused"
        UserDefaults.standard.set(enabled, forKey: Self.defaultsKey)
        Task { try? await APIClient.shared.setCapturePolicy(enabled: value) }
    }

    private func startPolling() {
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.pollOnce()
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    private func pollOnce() async {
        do {
            let health = try await APIClient.shared.fetchCaptureHealth()
            enabled = health.enabled
            let chrome = health.agents.first(where: { $0.id == "chrome_extension" })
            authorized = chrome?.authorized == true
            status = !enabled ? "Paused" : (chrome?.connected == true ? "Chrome extension connected" : "Load the Trace Chrome extension")
        } catch {
            status = "Waiting for Trace service"
        }
    }
}
