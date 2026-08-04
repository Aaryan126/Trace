import SwiftUI

@main
struct TraceApp: App {
    @StateObject private var feedStore = FeedStore()
    @StateObject private var captureStore = BrowserCaptureStore()

    var body: some Scene {
        MenuBarExtra {
            MenuBarView()
                .environmentObject(feedStore)
                .environmentObject(captureStore)
        } label: {
            StatusIcon(unreadCount: feedStore.unreadCount)
        }
        .menuBarExtraStyle(.window)
    }
}
