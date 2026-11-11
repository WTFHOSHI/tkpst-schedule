import Foundation

/// Что происходит прямо сейчас: для виджета и напоминаний.
public enum NowState: Equatable, Sendable {
    /// Идёт пара, классный час или перерыв между ними. `next` — что будет сразу после.
    case current(entry: Entry, next: Entry?)
    /// Занятий сейчас нет; `entry` — ближайшее занятие через `dayOffset` дней (0 — сегодня).
    case upcoming(entry: Entry, dayOffset: Int)
    /// В ближайшие дни занятий нет или расписание ещё не загружено.
    case free
}

public enum DayState {
    /// Занятие, а не перерыв и не отменённая пара.
    public static func isLesson(_ e: Entry) -> Bool {
        switch e {
        case .pause: return false
        case let .pair(_, _, _, _, status): return status != .cancelled
        case .classHour: return true
        }
    }

    /// Состояние на минуту `minute` от начала сегодняшних суток.
    /// `days(offset)` отдаёт ленту дня через `offset` дней от сегодняшнего (пустую, если расписания нет).
    public static func at(minute: Int, lookAheadDays: Int = 7, days: (Int) -> [Entry]) -> NowState {
        let today = days(0).sorted { $0.start < $1.start }
        let lessons = today.filter(isLesson)
        if let first = lessons.first, let last = lessons.last, minute < last.end {
            if minute < first.start { return .upcoming(entry: first, dayOffset: 0) }
            // Учебный день идёт: всё между первым и последним занятием, включая перерывы и окна.
            let span = today.filter { $0.start >= first.start && $0.end <= last.end }
            if let current = span.first(where: { minute >= $0.start && minute < $0.end }) {
                return .current(entry: current, next: span.first { $0.start >= current.end })
            }
            if let next = lessons.first(where: { $0.start > minute }) { return .upcoming(entry: next, dayOffset: 0) }
        }
        if lookAheadDays >= 1 {
            for offset in 1...lookAheadDays {
                if let first = days(offset).sorted(by: { $0.start < $1.start }).first(where: isLesson) {
                    return .upcoming(entry: first, dayOffset: offset)
                }
            }
        }
        return .free
    }

    /// Минуты сегодняшних суток, в которые состояние меняется (границы пар и перерывов).
    public static func boundaries(_ today: [Entry]) -> [Int] {
        Array(Set(today.flatMap { [$0.start, $0.end] })).sorted()
    }

    /// Первое очное занятие дня — к нему привязано напоминание.
    public static func firstInPerson(_ day: [Entry]) -> Entry? {
        day.sorted { $0.start < $1.start }.first { $0.isInPerson }
    }

    public static func duration(_ minutes: Int) -> String {
        let h = minutes / 60, m = minutes % 60
        if h == 0 { return "\(m) мин" }
        if m == 0 { return "\(h) ч" }
        return "\(h) ч \(m) мин"
    }
}

/// Подписи занятий для виджета и напоминания.
public enum EntryText {
    public static func title(_ e: Entry) -> String {
        switch e {
        case let .pair(number, _, _, lessons, status):
            if status == .cancelled { return "Пара отменена" }
            let names = unique(lessons.map { $0.title })
            return names.isEmpty ? "\(number) пара" : names.joined(separator: " / ")
        case let .classHour(_, _, title, _):
            return title.trimmingCharacters(in: .whitespaces).isEmpty ? "Классный час" : title
        case let .pause(_, _, kind):
            switch kind {
            case .big: return "Большой перерыв"
            case .window: return "Окно"
            case .short: return "Перерыв"
            }
        }
    }

    public static func cabinet(_ e: Entry) -> String {
        switch e {
        case let .pair(_, _, _, lessons, status):
            if status == .cancelled { return "" }
            if status == .remote { return "дистанционно" }
            let rooms = unique(lessons.map { $0.cabinet })
            return rooms.isEmpty ? "" : "каб. " + rooms.joined(separator: ", ")
        case let .classHour(_, _, _, cabinet):
            return cabinet.trimmingCharacters(in: .whitespaces).isEmpty ? "" : "каб. \(cabinet)"
        case .pause:
            return ""
        }
    }

    /// Короткое имя для строк «Сейчас: …» и «Далее: …».
    public static func kind(_ e: Entry) -> String {
        switch e {
        case let .pair(number, _, _, _, _): return "\(number) пара"
        case .classHour: return "классный час"
        case .pause: return title(e).lowercased()
        }
    }

    /// «10:10 – 11:40, 1 ч 30 мин, каб. 501».
    public static func span(_ e: Entry) -> String {
        ["\(Tyumen.hm(minutes: e.start)) – \(Tyumen.hm(minutes: e.end))", DayState.duration(e.end - e.start), cabinet(e)]
            .filter { !$0.isEmpty }.joined(separator: ", ")
    }

    private static func unique(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty && seen.insert($0).inserted }
    }
}
