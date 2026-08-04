import SwiftUI
import Combine

// MARK: - FeedStore

@MainActor
final class FeedStore: ObservableObject {
    @Published var events: [FeedEvent] = []
    @Published var unreadCount: Int = 0
    @Published var isServiceAvailable: Bool = true

    private var pollTask: Task<Void, Never>?

    init() {
        startPolling()
    }

    deinit {
        pollTask?.cancel()
    }

    // MARK: - Polling

    func startPolling() {
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.fetchFeed()
                try? await Task.sleep(nanoseconds: 30_000_000_000) // 30 seconds
            }
        }
        // Initial fetch immediately
        Task { [weak self] in
            await self?.fetchFeed()
        }
    }

    func fetchFeed() async {
        do {
            let response = try await APIClient.shared.fetchFeed(limit: 2, unreadOnly: true)
            events = response.events
            unreadCount = response.unread
            isServiceAvailable = true
        } catch {
            print("[Trace] Failed to fetch feed: \(error.localizedDescription)")
            isServiceAvailable = false
        }
    }

    // MARK: - Actions

    func markRead(id: String) async {
        do {
            try await APIClient.shared.markRead(id: id)
            // Optimistically update local state
            if let idx = events.firstIndex(where: { $0.id == id }) {
                let old = events[idx]
                events[idx] = FeedEvent(
                    id: old.id,
                    type: old.type,
                    threadId: old.threadId,
                    threadTitle: old.threadTitle,
                    data: old.data,
                    createdAt: old.createdAt,
                    read: true
                )
            }
            if unreadCount > 0 {
                unreadCount -= 1
            }
        } catch {
            print("[Trace] Failed to mark read: \(error.localizedDescription)")
        }
    }

    /// Opens the thread URL in the default browser.
    func openThread(threadId: String) {
        guard let url = URL(string: "http://127.0.0.1:3333/threads/\(threadId)") else { return }
        NSWorkspace.shared.open(url)
    }

    /// Opens the dashboard in the default browser.
    func openDashboard() {
        guard let url = URL(string: "http://127.0.0.1:3333") else { return }
        NSWorkspace.shared.open(url)
    }
}
