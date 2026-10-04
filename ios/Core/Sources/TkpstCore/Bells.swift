import Foundation

public struct Slot: Equatable, Sendable {
    public let number: Int
    public let start: Int   // минуты от начала суток
    public let end: Int
}

public struct ClassHourSlot: Equatable, Sendable {
    public let start: Int
    public let end: Int
    public let defaultTitle: String
}

/// Расписание звонков ТКПСТ — перенесено с фото «Расписание звонков».
public enum Bells {
    static func m(_ s: String) -> Int {
        let p = s.split(separator: ":").compactMap { Int($0) }
        return p[0] * 60 + p[1]
    }
    static func slot(_ n: Int, _ a: String, _ b: String) -> Slot { Slot(number: n, start: m(a), end: m(b)) }

    static let monday = [
        slot(1, "08:30", "10:00"), slot(2, "10:10", "11:40"), slot(3, "12:20", "13:50"),
        slot(4, "14:35", "16:05"), slot(5, "16:15", "17:45"), slot(6, "17:50", "18:50"),
    ]
    static let weekdays = [
        slot(1, "08:15", "09:45"), slot(2, "09:55", "11:25"), slot(3, "12:05", "13:35"),
        slot(4, "13:45", "15:15"), slot(5, "15:40", "17:10"), slot(6, "17:20", "18:50"),
    ]
    static let saturday = [
        slot(1, "08:15", "09:15"), slot(2, "09:25", "10:25"), slot(3, "10:35", "11:35"),
        slot(4, "12:05", "13:05"), slot(5, "13:15", "14:15"), slot(6, "14:25", "15:25"),
    ]

    public static let morningClassHour = ClassHourSlot(
        start: m("08:00"), end: m("08:30"),
        defaultTitle: "Поднятие Государственного флага РФ · «Разговоры о важном»"
    )
    public static let afternoonClassHour = ClassHourSlot(
        start: m("14:00"), end: m("14:30"),
        defaultTitle: "Классный час «Разговоры о важном»"
    )

    /// weekday: 1 = понедельник … 7 = воскресенье
    public static func pairs(weekday: Int) -> [Slot] {
        switch weekday {
        case 1: return monday
        case 6: return saturday
        case 7: return []
        default: return weekdays
        }
    }

    public static func classHours(weekday: Int) -> [ClassHourSlot] {
        weekday == 1 ? [morningClassHour, afternoonClassHour] : []
    }

    /// «8:05» / «08:05» → минуты от начала суток (или nil, если неверно).
    public static func parseHm(_ s: String?) -> Int? {
        let p = (s ?? "").trimmingCharacters(in: .whitespaces).split(separator: ":", omittingEmptySubsequences: false)
        guard p.count == 2 || p.count == 3, p[1].count == 2, (1...2).contains(p[0].count),
              let h = Int(p[0]), let m = Int(p[1]), (0...23).contains(h), (0...59).contains(m) else { return nil }
        return h * 60 + m
    }

    static func read(_ list: [BellTime]?) -> [Slot] {
        var out: [Slot] = []
        for x in list ?? [] {
            guard let a = parseHm(x.start), let b = parseHm(x.end), (1...8).contains(x.number), b > a,
                  !out.contains(where: { $0.number == x.number }) else { continue }
            out.append(Slot(number: x.number, start: a, end: b))
        }
        return out.sorted { $0.number < $1.number }
    }

    static func range(_ r: BellRange?, _ def: ClassHourSlot) -> ClassHourSlot {
        guard let a = parseHm(r?.start), let b = parseHm(r?.end), b > a else { return def }
        return ClassHourSlot(start: a, end: b, defaultTitle: def.defaultTitle)
    }

    /// Звонки дня с изменениями из админки: общее «Расписание звонков» (bells)
    /// и время пар на конкретную дату (days[дата].times).
    public static func pairs(weekday: Int, day: String?, overrides o: OverridesData?) -> [Slot] {
        let global: [BellTime]?
        switch weekday {
        case 1: global = o?.bells?.mon
        case 6: global = o?.bells?.sat
        case 7: return []
        default: global = o?.bells?.week
        }
        let g = read(global)
        var slots = g.isEmpty ? pairs(weekday: weekday) : g
        let t = read(o?.day(day)?.times)
        if !t.isEmpty {
            var byN: [Int: Slot] = [:]
            for s in slots { byN[s.number] = s }
            for s in t { byN[s.number] = s }
            slots = byN.values.sorted { $0.number < $1.number }
        }
        return slots
    }

    public static func flag(_ o: OverridesData?) -> ClassHourSlot { range(o?.bells?.flag, morningClassHour) }
    public static func classHour(_ o: OverridesData?) -> ClassHourSlot { range(o?.bells?.classHour, afternoonClassHour) }
}
