import Foundation

// Ответы OpenScheduleApi (https://github.com/ThisIsHyum/OpenScheduleApi)

public struct ApiReplace: Codable, Equatable, Sendable {
    public var title: String?
    public var cabinet: String?
    public var teacher: String?
    public init(title: String? = nil, cabinet: String? = nil, teacher: String? = nil) {
        self.title = title; self.cabinet = cabinet; self.teacher = teacher
    }
}

public struct ApiLesson: Codable, Equatable, Sendable {
    public var title: String
    public var cabinet: String?
    public var teacher: String?
    public var order: Int
    public var startTime: String?
    public var endTime: String?
    public var replace: ApiReplace?

    public init(title: String, cabinet: String? = nil, teacher: String? = nil, order: Int,
                startTime: String? = nil, endTime: String? = nil, replace: ApiReplace? = nil) {
        self.title = title; self.cabinet = cabinet; self.teacher = teacher; self.order = order
        self.startTime = startTime; self.endTime = endTime; self.replace = replace
    }

    enum CodingKeys: String, CodingKey { case title, cabinet, teacher, order, startTime, endTime, replace }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) ?? ""
        cabinet = try? c.decodeIfPresent(String.self, forKey: .cabinet)
        teacher = try? c.decodeIfPresent(String.self, forKey: .teacher)
        order = (try? c.decodeIfPresent(Int.self, forKey: .order)) ?? 0
        startTime = try? c.decodeIfPresent(String.self, forKey: .startTime)
        endTime = try? c.decodeIfPresent(String.self, forKey: .endTime)
        replace = try? c.decodeIfPresent(ApiReplace.self, forKey: .replace)
    }
}

public struct ApiDay: Codable, Sendable {
    public var groupId: Int?
    public var date: String?
    public var lessons: [ApiLesson]?
}

public struct ApiGroup: Codable, Sendable {
    public var studentGroupId: Int
    public var name: String
}

public struct ApiDate: Codable, Sendable {
    public var date: String?
}

public enum ScheduleParser {
    public struct ServerError: Error, LocalizedError {
        public let message: String
        public var errorDescription: String? { message }
    }

    /// Ответ может быть null, массивом дней или одним днём.
    public static func lessons(from data: Data) throws -> [ApiLesson] {
        let trimmed = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed == "null" { return [] }
        let decoder = JSONDecoder()
        if trimmed.hasPrefix("[") {
            return try decoder.decode([ApiDay].self, from: data).flatMap { $0.lessons ?? [] }
        }
        if let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any], obj["lessons"] == nil {
            throw ServerError(message: (obj["error"] as? String) ?? "Неизвестный ответ сервера")
        }
        return try decoder.decode(ApiDay.self, from: data).lessons ?? []
    }
}
