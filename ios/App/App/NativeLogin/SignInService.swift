import Foundation
import WebKit

/// What a sign-in attempt came to.
enum SignInResult {
    /// Signed in; the cookies are already in the web view.
    case signedIn
    /// A temporary password: the server gave only a setup session. The web
    /// app opens on "Choose your password" once the web view loads.
    case needsPasswordSetup
    /// Wrong details, locked, or turned off — `message` is the server's words.
    case refused(message: String, wrongPassword: Bool)
    case offline
}

/// Talks to the same endpoint as the website's /login page
/// (`POST /api/customer/login`, which also answers staff) and hands the
/// session cookies it gets to the web view, so the site opens already signed in.
final class SignInService {
    let baseURL: URL
    private let session: URLSession

    init(baseURL: URL) {
        self.baseURL = baseURL
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false      // we carry cookies by hand
        configuration.httpCookieAcceptPolicy = .never
        configuration.timeoutIntervalForRequest = 20
        session = URLSession(configuration: configuration)
    }

    /// The site's address, read from capacitor.config.json (the same
    /// `server.url` the web view loads, so a preview build signs in there).
    static func configuredBaseURL() -> URL {
        if let path = Bundle.main.path(forResource: "capacitor.config", ofType: "json"),
           let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let server = json["server"] as? [String: Any],
           let text = server["url"] as? String,
           let url = URL(string: text) {
            return url
        }
        return URL(string: "https://easystones.onrender.com")!
    }

    // MARK: Is there already a session?

    /// True when the web view's saved cookies still sign someone in.
    func hasValidSession(cookieStore: WKHTTPCookieStore) async -> Bool {
        let cookies = await allCookies(cookieStore).filter { cookie in
            guard let host = baseURL.host else { return false }
            return host == cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) || host.hasSuffix(cookie.domain)
        }
        guard !cookies.isEmpty else { return false }
        var request = URLRequest(url: baseURL.appendingPathComponent("api/user/me"))
        request.allHTTPHeaderFields = HTTPCookie.requestHeaderFields(with: cookies)
        guard let (_, response) = try? await session.data(for: request),
              let http = response as? HTTPURLResponse else { return false }
        return http.statusCode == 200
    }

    // MARK: Sign in

    @MainActor
    func signIn(identifier: String, password: String, cookieStore: WKHTTPCookieStore) async -> SignInResult {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/customer/login"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(baseURL.absoluteString, forHTTPHeaderField: "Origin")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["email": identifier, "password": password])

        guard let (data, response) = try? await session.data(for: request),
              let http = response as? HTTPURLResponse else { return .offline }
        let body = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]

        if (200...299).contains(http.statusCode) {
            await handOver(response: http, to: cookieStore)
            return .signedIn
        }
        if body["setup"] as? Bool == true {
            await handOver(response: http, to: cookieStore)
            return .needsPasswordSetup
        }
        let message = body["message"] as? String ?? "That didn't match an account. Check both fields and try again."
        return .refused(message: message, wrongPassword: http.statusCode == 401)
    }

    /// Puts every cookie the server set into the web view's own store.
    @MainActor
    private func handOver(response: HTTPURLResponse, to store: WKHTTPCookieStore) async {
        let headers = response.allHeaderFields.reduce(into: [String: String]()) { result, pair in
            if let key = pair.key as? String, let value = pair.value as? String { result[key] = value }
        }
        for cookie in HTTPCookie.cookies(withResponseHeaderFields: headers, for: baseURL) {
            await withCheckedContinuation { continuation in
                store.setCookie(cookie) { continuation.resume() }
            }
        }
    }

    @MainActor
    private func allCookies(_ store: WKHTTPCookieStore) async -> [HTTPCookie] {
        await withCheckedContinuation { continuation in
            store.getAllCookies { continuation.resume(returning: $0) }
        }
    }
}
