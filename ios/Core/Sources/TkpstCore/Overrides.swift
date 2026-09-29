import Foundation

/// Изменения из админ-панели (web/overrides.json на сайте). Приложение скачивает файл само.
public struct OverridePair: Codable, Equatable, Sendable {
    public var number: Int
    /// "remote" — дистант, "cancelled" — отменена, иначе как есть.
    public var status: String?
    public var title: String?
    public var cabinet: String?
    public var teacher: String?

    public init(number: Int, status: String? = nil, title: String? = nil, cabinet: String? = nil, teacher: String? = nil) {
        self.number = number; self.status = status; self.title = title; self.cabinet = cabinet; self.teacher = teacher
    }

    enum CodingKeys: String, CodingKey { case number, status, title, cabinet, teacher }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        number = (try? c.decodeIfPresent(Int.self, forKey: .number)) ?? 0
        status = try? c.decodeIfPresent(String.self, forKey: .status)
        title = try? c.decodeIfPresent(String.self, forKey: .title)
        cabinet = try? c.decodeIfPresent(String.self, forKey: .cabinet)
        teacher = try? c.decodeIfPresent(String.self, forKey: .teacher)
    }
}

public struct OverrideDay: Codable, Equatable, Sendable {
    public var note: String?
    /// Своё расписание на день: пары колледжа не используются.
    public var replaceAll: Bool
    public var pairs: [OverridePair]

    public init(note: String? = nil, replaceAll: Bool = false, pairs: [OverridePair] = []) {
        self.note = note; self.replaceAll = replaceAll; self.pairs = pairs
    }

    enum CodingKeys: String, CodingKey { case note, replaceAll, pairs }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        note = try? c.decodeIfPresent(String.self, forKey: .note)
        replaceAll = (try? c.decodeIfPresent(Bool.self, forKey: .replaceAll)) ?? false
        pairs = (try? c.decodeIfPresent([OverridePair].self, forKey: .pairs)) ?? []
    }
}

public struct OverridesData: Codable, Equatable, Sendable {
    public var announcement: String?
    public var updatedAt: String?
    public var days: [String: OverrideDay]

    public init(announcement: String? = nil, updatedAt: String? = nil, days: [String: OverrideDay] = [:]) {
        self.announcement = announcement; self.updatedAt = updatedAt; self.days = days
    }

    enum CodingKeys: String, CodingKey { case announcement, updatedAt, days }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        announcement = try? c.decodeIfPresent(String.self, forKey: .announcement)
        updatedAt = try? c.decodeIfPresent(String.self, forKey: .updatedAt)
        days = (try? c.decodeIfPresent([String: OverrideDay].self, forKey: .days)) ?? [:]
    }

    /// isoDay — «YYYY-MM-DD»
    public func day(_ isoDay: String?) -> OverrideDay? { isoDay.flatMap { days[$0] } }

    /// Даты, где изменения отличаются.
    public func changedDays(comparedTo old: OverridesData) -> [String] {
        Set(days.keys).union(old.days.keys).filter { days[$0] != old.days[$0] }.sorted()
    }
}
