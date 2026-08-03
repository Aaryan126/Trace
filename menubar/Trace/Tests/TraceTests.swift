import XCTest
@testable import Trace

final class TraceTests: XCTestCase {

    // MARK: - FeedResponse Decoding

    func testFeedResponseDecoding() throws {
        let json = """
        {
            "events": [
                {
                    "id": "evt_001",
                    "type": "digest",
                    "thread_id": "thr_abc",
                    "payload": {
                        "title": "Weekly digest",
                        "count": 5
                    },
                    "created_at": "2026-07-26T10:00:00Z",
                    "read": false
                },
                {
                    "id": "evt_002",
                    "type": "commit_closed",
                    "thread_id": null,
                    "payload": {
                        "message": "Build passed"
                    },
                    "created_at": "2026-07-26T09:30:00Z",
                    "read": true
                }
            ],
            "total": 2,
            "unread": 1
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(FeedResponse.self, from: json)
        XCTAssertEqual(response.events.count, 2)
        XCTAssertEqual(response.total, 2)
        XCTAssertEqual(response.unread, 1)
        XCTAssertEqual(response.events[0].id, "evt_001")
        XCTAssertEqual(response.events[0].type, "digest")
        XCTAssertEqual(response.events[0].thread_id, "thr_abc")
        XCTAssertFalse(response.events[0].read)
        XCTAssertNil(response.events[1].thread_id)
        XCTAssertTrue(response.events[1].read)
    }

    func testFeedResponseDecodingEmptyEvents() throws {
        let json = """
        {
            "events": [],
            "total": 0,
            "unread": 0
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(FeedResponse.self, from: json)
        XCTAssertTrue(response.events.isEmpty)
        XCTAssertEqual(response.total, 0)
        XCTAssertEqual(response.unread, 0)
    }

    // MARK: - FeedEvent Type Detection

    func testFeedEventTypeLabels() {
        let types: [(String, String)] = [
            ("reopen", "Reopen"),
            ("digest", "Digest"),
            ("commit_closed", "Commit Closed"),
            ("nudge", "Nudge"),
            ("custom_type", "Custom Type"),
        ]

        for (raw, expected) in types {
            XCTAssertEqual(raw.formattedEventType, expected, "Type '\(raw)' should format to '\(expected)'")
        }
    }

    func testFeedEventSummary() throws {
        let json = """
        {
            "id": "evt_100",
            "type": "digest",
            "thread_id": "thr_xyz",
            "payload": { "title": "Daily Summary" },
            "created_at": "2026-07-26T08:00:00Z",
            "read": false
        }
        """.data(using: .utf8)!

        let event = try JSONDecoder().decode(FeedEvent.self, from: json)
        XCTAssertEqual(event.summary, "Daily Summary")
    }

    func testFeedEventSummaryFallbackToMessage() throws {
        let json = """
        {
            "id": "evt_101",
            "type": "nudge",
            "thread_id": null,
            "payload": { "message": "Check your threads" },
            "created_at": "2026-07-26T08:00:00Z",
            "read": false
        }
        """.data(using: .utf8)!

        let event = try JSONDecoder().decode(FeedEvent.self, from: json)
        XCTAssertEqual(event.summary, "Check your threads")
    }

    func testFeedEventSummaryFallbackToType() throws {
        let json = """
        {
            "id": "evt_102",
            "type": "reopen",
            "thread_id": null,
            "payload": {},
            "created_at": "2026-07-26T08:00:00Z",
            "read": false
        }
        """.data(using: .utf8)!

        let event = try JSONDecoder().decode(FeedEvent.self, from: json)
        XCTAssertEqual(event.summary, "Reopen")
    }

    // MARK: - Relative Time Formatting

    func testRelativeTimeJustNow() {
        let now = Date()
        let result = RelativeTimeFormatter.format(from: now)
        XCTAssertEqual(result, "just now")
    }

    func testRelativeTimeMinutes() {
        let fiveMinutesAgo = Date().addingTimeInterval(-300)
        let result = RelativeTimeFormatter.format(from: fiveMinutesAgo)
        XCTAssertEqual(result, "5m ago")
    }

    func testRelativeTimeHours() {
        let twoHoursAgo = Date().addingTimeInterval(-7200)
        let result = RelativeTimeFormatter.format(from: twoHoursAgo)
        XCTAssertEqual(result, "2h ago")
    }

    func testRelativeTimeDays() {
        let threeDaysAgo = Date().addingTimeInterval(-259200)
        let result = RelativeTimeFormatter.format(from: threeDaysAgo)
        XCTAssertEqual(result, "3d ago")
    }

    func testRelativeTimeFromISOString() {
        let result = RelativeTimeFormatter.format(from: "not-a-date")
        XCTAssertEqual(result, "unknown")
    }

    // MARK: - JSONValue

    func testJSONValueDecoding() throws {
        let json = """
        {
            "str": "hello",
            "num": 42.5,
            "bool": true,
            "nil_val": null,
            "arr": [1, 2],
            "obj": { "key": "val" }
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode([String: JSONValue].self, from: json)
        XCTAssertEqual(decoded["str"], .string("hello"))
        XCTAssertEqual(decoded["num"], .number(42.5))
        XCTAssertEqual(decoded["bool"], .bool(true))
        XCTAssertEqual(decoded["nil_val"], .null)
        XCTAssertEqual(decoded["arr"], .array([.number(1), .number(2)]))
        XCTAssertEqual(decoded["obj"], .object(["key": .string("val")]))
    }

    func testJSONValueStringValue() {
        let val = JSONValue.string("test")
        XCTAssertEqual(val.stringValue, "test")

        let numVal = JSONValue.number(42)
        XCTAssertNil(numVal.stringValue)
    }

    // MARK: - APIClient URL Construction

    func testAPIClientURLConstruction() async {
        let client = APIClient()
        let url = await client.url(for: "api/feed")
        XCTAssertEqual(url.absoluteString, "http://127.0.0.1:3333/api/feed")
    }

    func testAPIClientMarkReadURL() async {
        let client = APIClient()
        let url = await client.url(for: "api/feed/evt_123/read")
        XCTAssertEqual(url.absoluteString, "http://127.0.0.1:3333/api/feed/evt_123/read")
    }
}
