import SwiftUI

@main
struct BrainchApp: App {
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
