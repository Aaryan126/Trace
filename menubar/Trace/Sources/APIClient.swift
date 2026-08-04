import Foundation

// MARK: - APIClient

actor APIClient {
    static let shared = APIClient()

    private let baseURL: URL
    private let session: URLSession
    private let captureToken: String

    init(session: URLSession = .shared) {
        let port = ProcessInfo.processInfo.environment["TRACE_PORT"] ?? "3333"
        self.baseURL = URL(string: "http://127.0.0.1:\(port)")!
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 10
        config.timeoutIntervalForResource = 10
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        self.session = URLSession(configuration: config)
        self.captureToken = ProcessInfo.processInfo.environment["TRACE_CAPTURE_TOKEN"] ?? ""
    }

    // MARK: - Feed

    /// Fetches the latest feed events from the API.
    func fetchFeed(limit: Int = 2, unreadOnly: Bool = true) async throws -> FeedResponse {
        var components = URLComponents(url: baseURL.appendingPathComponent("api/feed"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "unreadOnly", value: unreadOnly ? "true" : "false"),
        ]
        guard let url = components.url else {
            throw APIError.invalidURL
        }

        let (data, response) = try await session.data(from: url)
        try validateResponse(response)
        return try JSONDecoder().decode(FeedResponse.self, from: data)
    }

    /// Marks a specific feed event as read.
    func markRead(id: String) async throws {
        let url = baseURL.appendingPathComponent("api/feed/\(id)/read")
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"

        let (_, response) = try await session.data(for: request)
        try validateResponse(response)
    }

    func reportCaptureStatus(enabled: Bool, authorized: Bool) async throws {
        try await sendCaptureRequest(path: "api/browser-capture/status", method: "POST", body: [
            "enabled": enabled,
            "authorized": authorized,
        ])
    }

    func setCapturePolicy(enabled: Bool) async throws {
        try await sendCaptureRequest(path: "api/browser-capture/policy", method: "POST", body: ["enabled": enabled])
    }

    func fetchCaptureHealth() async throws -> BrowserCaptureHealth {
        let (data, response) = try await session.data(from: baseURL.appendingPathComponent("api/live"))
        try validateResponse(response)
        return try JSONDecoder().decode(LiveTraceHealthResponse.self, from: data).capture
    }

    func fetchNextCapture() async throws -> BrowserCaptureRequest? {
        var request = captureRequest(path: "api/browser-capture/next", method: "POST")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 3
        request.httpBody = Data("{}".utf8)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 204 { return nil }
        try validateResponse(response)
        return try JSONDecoder().decode(BrowserCaptureRequest.self, from: data)
    }

    func completeCapture(id: String, payload: BrowserCapturePayload) async throws {
        let data = try JSONEncoder().encode(payload)
        try await sendCaptureRequest(path: "api/browser-capture/\(id)/complete", method: "POST", data: data)
    }

    func reportCaptureStage(id: String, stage: String) async throws {
        let data = try JSONSerialization.data(withJSONObject: ["stage": stage])
        try await sendCaptureRequest(path: "api/browser-capture/\(id)/stage", method: "POST", data: data)
    }

    func skipCapture(id: String, reason: String) async throws {
        let data = try JSONSerialization.data(withJSONObject: ["reason": reason])
        try await sendCaptureRequest(path: "api/browser-capture/\(id)/skip", method: "POST", data: data)
    }

    // MARK: - Helpers

    private func validateResponse(_ response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIError.httpError(httpResponse.statusCode)
        }
    }

    private func captureRequest(path: String, method: String) -> URLRequest {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue(captureToken, forHTTPHeaderField: "X-Trace-Capture-Token")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }

    private func sendCaptureRequest(path: String, method: String, body: [String: Bool]) async throws {
        try await sendCaptureRequest(path: path, method: method, data: try JSONSerialization.data(withJSONObject: body))
    }

    private func sendCaptureRequest(path: String, method: String, data: Data) async throws {
        var request = captureRequest(path: path, method: method)
        request.httpBody = data
        let (_, response) = try await session.data(for: request)
        try validateResponse(response)
    }

    /// Constructs the URL for a given path (exposed for testing).
    func url(for path: String) -> URL {
        baseURL.appendingPathComponent(path)
    }
}

// MARK: - APIError

enum APIError: Error, LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(Int)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid URL"
        case .invalidResponse: return "Invalid response from server"
        case .httpError(let code): return "HTTP error: \(code)"
        }
    }
}
