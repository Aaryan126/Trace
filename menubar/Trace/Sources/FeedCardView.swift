import SwiftUI

// MARK: - FeedCardView

struct FeedCardView: View {
    let event: FeedEvent

    var body: some View {
        HStack(spacing: 8) {
            // Left color bar
            Rectangle()
                .fill(colorForType)
                .frame(width: 2)

            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    // Event type icon + label
                    Image(systemName: iconForType)
                        .foregroundStyle(colorForType)
                        .font(.system(size: 9))
                    Text(event.typeLabel)
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(.secondary)

                    Spacer()

                    // Relative time
                    Text(RelativeTimeFormatter.format(from: event.createdAt))
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                }

                // Summary text
                Text(event.summary)
                    .font(.system(size: 12))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                    .truncationMode(.tail)
            }
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 8)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(Color.white.opacity(0.05))
        )
    }

    // MARK: - Type Styling

    private var colorForType: Color {
        switch event.type {
        case "commit_closed": return .green
        case "reopen": return .orange
        case "digest": return .blue
        case "nudge": return .purple
        default: return .gray
        }
    }

    private var iconForType: String {
        switch event.type {
        case "commit_closed": return "checkmark.circle"
        case "reopen": return "arrow.counterclockwise"
        case "digest": return "doc.text"
        case "nudge": return "bell"
        default: return "circle"
        }
    }
}
