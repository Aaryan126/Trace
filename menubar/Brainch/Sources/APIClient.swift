import Foundation

// MARK: - APIClient

actor APIClient {
    static let shared = APIClient()

    private let baseURL = URL(string: "http://127.0.0.1:3333")!
    private let session: URLSession

    init(session: URLSession = .shared) {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 10
        config.timeoutIntervalForResource = 10
        self.session = URLSession(configuration: config)
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

    // MARK: - Helpers

    private func validateResponse(_ response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIError.httpError(httpResponse.statusCode)
        }
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
