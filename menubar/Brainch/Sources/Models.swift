import Foundation

// MARK: - JSONValue

/// A type-safe representation of arbitrary JSON values.
enum JSONValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let boolVal = try? container.decode(Bool.self) {
            self = .bool(boolVal)
        } else if let numVal = try? container.decode(Double.self) {
            self = .number(numVal)
        } else if let strVal = try? container.decode(String.self) {
            self = .string(strVal)
        } else if let arrVal = try? container.decode([JSONValue].self) {
            self = .array(arrVal)
        } else if let objVal = try? container.decode([String: JSONValue].self) {
            self = .object(objVal)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unable to decode JSONValue"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let val): try container.encode(val)
        case .number(let val): try container.encode(val)
        case .bool(let val): try container.encode(val)
        case .object(let val): try container.encode(val)
        case .array(let val): try container.encode(val)
        case .null: try container.encodeNil()
        }
    }

    /// Convenience accessor for string values.
    var stringValue: String? {
        if case .string(let val) = self { return val }
        return nil
    }
}

// MARK: - FeedResponse

struct FeedResponse: Codable, Equatable {
    let events: [FeedEvent]
    let total: Int
    let unread: Int
}

// MARK: - FeedEvent

struct FeedEvent: Codable, Identifiable, Equatable {
    let id: String
    let type: String  // reopen, digest, commit_closed, nudge
    let thread_id: String?
    let payload: [String: JSONValue]
    let created_at: String
    let read: Bool

    /// Returns a human-readable summary from the payload, falling back to the event type.
    var summary: String {
        if let title = payload["title"]?.stringValue {
            return title
        }
        if let message = payload["message"]?.stringValue {
            return message
        }
        if let summary = payload["summary"]?.stringValue {
            return summary
        }
        return type.formattedEventType
    }

    /// Event type display string.
    var typeLabel: String {
        type.formattedEventType
    }

    static func == (lhs: FeedEvent, rhs: FeedEvent) -> Bool {
        lhs.id == rhs.id
            && lhs.type == rhs.type
            && lhs.thread_id == rhs.thread_id
            && lhs.created_at == rhs.created_at
            && lhs.read == rhs.read
    }
}

// MARK: - String Extension

extension String {
    var formattedEventType: String {
        switch self {
        case "reopen": return "Reopen"
        case "digest": return "Digest"
        case "commit_closed": return "Commit Closed"
        case "nudge": return "Nudge"
        default: return self.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}

// MARK: - Relative Time Formatting

struct RelativeTimeFormatter {
    static func format(from isoString: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: isoString) else {
            // Try without fractional seconds
            formatter.formatOptions = [.withInternetDateTime]
            guard let date = formatter.date(from: isoString) else {
                return "unknown"
            }
            return format(from: date)
        }
        return format(from: date)
    }

    static func format(from date: Date) -> String {
        let now = Date()
        let interval = now.timeIntervalSince(date)

        if interval < 60 {
            return "just now"
        } else if interval < 3600 {
            let minutes = Int(interval / 60)
            return "\(minutes)m ago"
        } else if interval < 86400 {
            let hours = Int(interval / 3600)
            return "\(hours)h ago"
        } else {
            let days = Int(interval / 86400)
            return "\(days)d ago"
        }
    }
}
