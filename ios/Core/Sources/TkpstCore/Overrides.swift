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

/// Время пары из админки: «08:30»–«10:00».
public struct BellTime: Codable, Equatable, Sendable {
    public var number: Int
    public var start: String?
    public var end: String?

    public init(_ number: Int, _ start: String?, _ end: String?) { self.number = number; self.start = start; self.end = end }

    enum CodingKeys: String, CodingKey { case number, start, end }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        number = (try? c.decodeIfPresent(Int.self, forKey: .number)) ?? 0
        start = try? c.decodeIfPresent(String.self, forKey: .start)
        end = try? c.decodeIfPresent(String.self, forKey: .end)
    }
}

public struct BellRange: Codable, Equatable, Sendable {
    public var start: String?
    public var end: String?

    public init(_ start: String?, _ end: String?) { self.start = start; self.end = end }

    enum CodingKeys: String, CodingKey { case start, end }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        start = try? c.decodeIfPresent(String.self, forKey: .start)
        end = try? c.decodeIfPresent(String.self, forKey: .end)
    }
}

/// Общее «Расписание звонков» из админки — заменяет звонки с фото.
public struct BellsData: Codable, Equatable, Sendable {
    public var mon: [BellTime]?
    /// Вторник–пятница.
    public var week: [BellTime]?
    public var sat: [BellTime]?
    /// Поднятие флага.
    public var flag: BellRange?
    public var classHour: BellRange?

    public init(mon: [BellTime]? = nil, week: [BellTime]? = nil, sat: [BellTime]? = nil, flag: BellRange? = nil, classHour: BellRange? = nil) {
        self.mon = mon; self.week = week; self.sat = sat; self.flag = flag; self.classHour = classHour
    }

    enum CodingKeys: String, CodingKey { case mon, week, sat, flag, classHour }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mon = try? c.decodeIfPresent([BellTime].self, forKey: .mon)
        week = try? c.decodeIfPresent([BellTime].self, forKey: .week)
        sat = try? c.decodeIfPresent([BellTime].self, forKey: .sat)
        flag = try? c.decodeIfPresent(BellRange.self, forKey: .flag)
        classHour = try? c.decodeIfPresent(BellRange.self, forKey: .classHour)
    }
}

public struct OverrideDay: Codable, Equatable, Sendable {
    public var note: String?
    /// Своё расписание на день: пары колледжа не используются.
    public var replaceAll: Bool
    public var pairs: [OverridePair]
    /// Время пар только на этот день (только изменённые пары).
    public var times: [BellTime]
    /// Поднятие флага: true — есть, false — нет, nil — как обычно.
    public var flag: Bool?
    /// Классный час: true — есть, false — нет, nil — как обычно.
    public var classHour: Bool?

    public init(note: String? = nil, replaceAll: Bool = false, pairs: [OverridePair] = [],
                times: [BellTime] = [], flag: Bool? = nil, classHour: Bool? = nil) {
        self.note = note; self.replaceAll = replaceAll; self.pairs = pairs
        self.times = times; self.flag = flag; self.classHour = classHour
    }

    enum CodingKeys: String, CodingKey { case note, replaceAll, pairs, times, flag, classHour }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        note = try? c.decodeIfPresent(String.self, forKey: .note)
        replaceAll = (try? c.decodeIfPresent(Bool.self, forKey: .replaceAll)) ?? false
        pairs = (try? c.decodeIfPresent([OverridePair].self, forKey: .pairs)) ?? []
        times = (try? c.decodeIfPresent([BellTime].self, forKey: .times)) ?? []
        flag = try? c.decodeIfPresent(Bool.self, forKey: .flag)
        classHour = try? c.decodeIfPresent(Bool.self, forKey: .classHour)
    }
}

public struct OverridesData: Codable, Equatable, Sendable {
    public var announcement: String?
    public var updatedAt: String?
    public var bells: BellsData?
    public var days: [String: OverrideDay]

    public init(announcement: String? = nil, updatedAt: String? = nil, bells: BellsData? = nil, days: [String: OverrideDay] = [:]) {
        self.announcement = announcement; self.updatedAt = updatedAt; self.bells = bells; self.days = days
    }

    enum CodingKeys: String, CodingKey { case announcement, updatedAt, bells, days }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        announcement = try? c.decodeIfPresent(String.self, forKey: .announcement)
        updatedAt = try? c.decodeIfPresent(String.self, forKey: .updatedAt)
        bells = try? c.decodeIfPresent(BellsData.self, forKey: .bells)
        days = (try? c.decodeIfPresent([String: OverrideDay].self, forKey: .days)) ?? [:]
    }

    /// isoDay — «YYYY-MM-DD»
    public func day(_ isoDay: String?) -> OverrideDay? { isoDay.flatMap { days[$0] } }

    /// Даты, где изменения отличаются.
    public func changedDays(comparedTo old: OverridesData) -> [String] {
        Set(days.keys).union(old.days.keys).filter { days[$0] != old.days[$0] }.sorted()
    }
}
