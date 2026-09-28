import Foundation

struct HttpError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Простой GET с понятным User-Agent (его требует OpenStreetMap).
enum Http {
    static let userAgent = "TkpstSchedule/1.0 (iOS; github.com/WTFHOSHI/tkpst-schedule)"

    static let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 15
        c.timeoutIntervalForResource = 60
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: c)
    }()

    static func get(_ url: String, timeout: TimeInterval = 15) async throws -> Data {
        guard let u = URL(string: url) else { throw HttpError(message: "Неверный адрес") }
        var req = URLRequest(url: u, timeoutInterval: timeout)
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        req.setValue("ru", forHTTPHeaderField: "Accept-Language")
        let (data, resp) = try await session.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else { throw HttpError(message: "Сервер ответил \(code)") }
        return data
    }

    static func enc(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&=+,"))) ?? s
    }
}
