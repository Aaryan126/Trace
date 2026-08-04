import SwiftUI

// MARK: - MenuBarView

struct MenuBarView: View {
    @EnvironmentObject var feedStore: FeedStore
    @EnvironmentObject var captureStore: BrowserCaptureStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack {
                Text("Trace")
                    .font(.system(size: 14, weight: .semibold))
                Spacer()
                if feedStore.unreadCount > 0 {
                    Text("\(feedStore.unreadCount)")
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(
                            Capsule().fill(Color.red)
                        )
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)
            .padding(.bottom, 6)

            Divider()

            // Content
            if !feedStore.isServiceAvailable {
                serviceUnavailableView
            } else if feedStore.events.isEmpty {
                allCaughtUpView
            } else {
                eventsList
            }

            Divider()

            VStack(alignment: .leading, spacing: 4) {
                Toggle("Automatic browser screenshots", isOn: Binding(
                    get: { captureStore.enabled },
                    set: { captureStore.setEnabled($0) }
                ))
                .font(.system(size: 12))
                Text(captureStore.status)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                Text("Chrome captures only approved research pages. No Screen Recording permission needed.")
                    .font(.system(size: 9))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            // Footer actions
            footerActions
        }
        .frame(minWidth: 260, maxWidth: 320)
        .frame(maxHeight: 300)
    }

    // MARK: - Subviews

    private var serviceUnavailableView: some View {
        VStack(spacing: 4) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 20))
                .foregroundStyle(.secondary)
            Text("Service unavailable")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
            Text("Retrying…")
                .font(.system(size: 10))
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
    }

    private var allCaughtUpView: some View {
        VStack(spacing: 4) {
            Image(systemName: "checkmark.seal")
                .font(.system(size: 20))
                .foregroundStyle(.green)
            Text("All caught up")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
    }

    private var eventsList: some View {
        VStack(spacing: 6) {
            ForEach(feedStore.events) { event in
                Button(action: {
                    if !event.threadId.isEmpty {
                        feedStore.openThread(threadId: event.threadId)
                    }
                    Task { await feedStore.markRead(id: event.id) }
                }) {
                    FeedCardView(event: event)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
    }

    private var footerActions: some View {
        VStack(spacing: 0) {
            Button(action: { feedStore.openDashboard() }) {
                HStack {
                    Image(systemName: "macwindow")
                        .font(.system(size: 11))
                    Text("Open Dashboard")
                        .font(.system(size: 12))
                    Spacer()
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
            }
            .buttonStyle(.plain)

            Divider()

            Button(action: { NSApp.terminate(nil) }) {
                HStack {
                    Image(systemName: "power")
                        .font(.system(size: 11))
                    Text("Quit")
                        .font(.system(size: 12))
                    Spacer()
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 4)
    }
}
