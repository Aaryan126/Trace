import SwiftUI

@main
struct TraceApp: App {
    @StateObject private var feedStore = FeedStore()

    var body: some Scene {
        MenuBarExtra {
            MenuBarView()
                .environmentObject(feedStore)
        } label: {
            StatusIcon(unreadCount: feedStore.unreadCount)
        }
        .menuBarExtraStyle(.window)
    }
}
