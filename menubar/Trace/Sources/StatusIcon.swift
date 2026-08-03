import SwiftUI

// MARK: - StatusIcon

struct StatusIcon: View {
    let unreadCount: Int

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Image(systemName: iconName)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(iconColor)
                .font(.system(size: 14))

            if unreadCount > 0 {
                Circle()
                    .fill(Color.red)
                    .frame(width: 7, height: 7)
                    .offset(x: 3, y: -2)
            }
        }
    }

    private var iconName: String {
        "point.3.connected.trianglepath.dotted"
    }

    private var iconColor: Color {
        unreadCount > 0 ? Color.primary : Color.secondary
    }
}
