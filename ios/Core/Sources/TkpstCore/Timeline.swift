import Foundation

public struct LessonInfo: Equatable, Sendable {
    public let title: String
    public let cabinet: String
    public let teacher: String
    public var replaced: Bool = false
    public var oldTitle: String? = nil
    public var oldCabinet: String? = nil
    public var oldTeacher: String? = nil
}

public enum BreakKind: Sendable { case short, big, window }

public enum Entry: Equatable, Sendable, Identifiable {
    case pair(number: Int, start: Int, end: Int, lessons: [LessonInfo])
    case classHour(start: Int, end: Int, title: String, cabinet: String)
    case pause(start: Int, end: Int, kind: BreakKind)

    public var start: Int {
        switch self {
        case let .pair(_, s, _, _), let .classHour(s, _, _, _), let .pause(s, _, _): return s
        }
    }

    public var end: Int {
        switch self {
        case let .pair(_, _, e, _), let .classHour(_, e, _, _), let .pause(_, e, _): return e
        }
    }

    public var id: String {
        switch self {
        case .pair: return "p\(start)"
        case .classHour: return "c\(start)"
        case .pause: return "b\(start)"
        }
    }
}

public enum Timeline {

    static func parseTime(_ s: String?) -> Int? {
        guard let s = s?.trimmingCharacters(in: .whitespaces), !s.isEmpty else { return nil }
        let p = s.split(separator: ":").compactMap { Int($0) }
        guard p.count >= 2 else { return nil }
        return p[0] * 60 + p[1]
    }

    static func clean(_ s: String?) -> String {
        guard let s else { return "" }
        return s.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    static func isClassHourTitle(_ t: String) -> Bool {
        t.range(of: "классный час", options: .caseInsensitive) != nil
    }

    static func info(_ l: ApiLesson) -> LessonInfo {
        let title = clean(l.title), cab = clean(l.cabinet), teacher = clean(l.teacher)
        guard let r = l.replace else { return LessonInfo(title: title, cabinet: cab, teacher: teacher) }
        let nt = clean(r.title).isEmpty ? title : clean(r.title)
        let nc = clean(r.cabinet).isEmpty ? cab : clean(r.cabinet)
        let nte = clean(r.teacher).isEmpty ? teacher : clean(r.teacher)
        return LessonInfo(
            title: nt, cabinet: nc, teacher: nte, replaced: true,
            oldTitle: title != nt ? title : nil,
            oldCabinet: cab != nc ? cab : nil,
            oldTeacher: teacher != nte ? teacher : nil
        )
    }

    /// Лента дня: пары (время — по звонкам с фото), классные часы понедельника и перерывы/окна.
    /// weekday: 1 = понедельник … 7 = воскресенье
    public static func build(weekday: Int, lessons: [ApiLesson]) -> [Entry] {
        if weekday == 7 || lessons.isEmpty { return [] }
        let pairSlots = Bells.pairs(weekday: weekday)
        let chSlots = Bells.classHours(weekday: weekday)

        var classHours: [Int: Entry] = [:]
        var pairs: [Int: [LessonInfo]] = [:]
        var custom: [Int: (Int, Int)] = [:]

        // В понедельник API считает классный час 8:00 «первой парой» — номера сдвинуты.
        let mondayShift = weekday == 1 && lessons.contains {
            $0.order == 1 && (isClassHourTitle($0.title) || parseTime($0.startTime) == Bells.morningClassHour.start)
        }

        for l in lessons {
            let st = parseTime(l.startTime)
            let chSlot = chSlots.first { $0.start == st }
            if chSlot != nil || isClassHourTitle(l.title) {
                let slot = chSlot ?? chSlots.min { a, b in
                    guard let st else { return false }
                    return abs(a.start - st) < abs(b.start - st)
                }
                guard let start = slot?.start ?? st else { continue }
                let end = slot?.end ?? parseTime(l.endTime) ?? start + 30
                let title = clean(l.title).isEmpty ? (slot?.defaultTitle ?? "Классный час") : clean(l.title)
                classHours[start] = .classHour(start: start, end: end, title: title, cabinet: clean(l.cabinet))
                continue
            }
            let number = pairSlots.first { $0.start == st }?.number ?? (mondayShift ? l.order - 1 : l.order)
            if number <= 0 { continue }
            if !pairSlots.contains(where: { $0.number == number }) {
                guard let a = st else { continue }
                custom[number] = (a, parseTime(l.endTime) ?? a + 90)
            }
            pairs[number, default: []].append(info(l))
        }

        // Классные часы понедельника показываем, даже если API их не прислал.
        if weekday == 1 && !pairs.isEmpty {
            let m = Bells.morningClassHour, a = Bells.afternoonClassHour
            if classHours[m.start] == nil && pairs.keys.contains(where: { $0 <= 3 }) {
                classHours[m.start] = .classHour(start: m.start, end: m.end, title: m.defaultTitle, cabinet: "")
            }
            if classHours[a.start] == nil && pairs.keys.contains(where: { $0 >= 4 }) {
                classHours[a.start] = .classHour(start: a.start, end: a.end, title: a.defaultTitle, cabinet: "")
            }
        }

        var main: [Entry] = Array(classHours.values)
        for (n, infos) in pairs {
            if let s = pairSlots.first(where: { $0.number == n }) {
                main.append(.pair(number: n, start: s.start, end: s.end, lessons: infos))
            } else if let c = custom[n] {
                main.append(.pair(number: n, start: c.0, end: c.1, lessons: infos))
            }
        }
        main.sort { $0.start < $1.start }

        var result: [Entry] = []
        for (i, e) in main.enumerated() {
            if i > 0 {
                let prev = main[i - 1]
                let gap = e.start - prev.end
                if gap > 0 {
                    let skipped = pairSlots.contains { $0.start >= prev.end && $0.end <= e.start }
                    let kind: BreakKind = skipped ? .window : (gap >= 25 ? .big : .short)
                    result.append(.pause(start: prev.end, end: e.start, kind: kind))
                }
            }
            result.append(e)
        }
        return result
    }

    /// «1 ч 20 мин», «45 мин», «меньше минуты». Минуты округляются вверх.
    public static func formatLeft(_ seconds: Int) -> String {
        if seconds < 60 { return "меньше минуты" }
        let total = (seconds + 59) / 60
        let h = total / 60, m = total % 60
        if h > 0 && m > 0 { return "\(h) ч \(m) мин" }
        if h > 0 { return "\(h) ч" }
        return "\(m) мин"
    }
}
