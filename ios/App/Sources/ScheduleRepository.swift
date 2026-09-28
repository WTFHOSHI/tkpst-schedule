import Foundation
import TkpstCore

enum DayChange { case published, changed }

struct DayData {
    let lessons: [ApiLesson]
    /// true — показаны сохранённые данные (нет сети).
    let offline: Bool
    let savedAt: Date?
    /// Дата позже последнего опубликованного дня — расписания ещё нет.
    let notPublished: Bool
    var change: DayChange? = nil
}

/// Пары группы ИС-25-3С из OpenScheduleApi + кэш на телефоне.
actor ScheduleRepository {
    static let shared = ScheduleRepository()

    static let base = "https://api.thisishyum.ru/schedule_api/tyumen"
    static let groupName = "ИС-25-3С"
    static let collegeId = 1
    /// Проверено вручную 28.09.2026: ИС-25-3С, кампус «Луначарского 2 курс».
    static let fallbackGroupId = 196
    static let keepDays = 14

    private let defaults = UserDefaults(suiteName: "schedule_cache") ?? .standard

    private func normalize(_ s: String) -> String { s.replacingOccurrences(of: " ", with: "").uppercased() }

    /// Группа закреплена: id ищется один раз и сохраняется.
    private func groupId() async -> Int {
        let saved = defaults.integer(forKey: "group_id")
        if saved > 0 { return saved }
        var id = Self.fallbackGroupId
        if let data = try? await Http.get("\(Self.base)/colleges/\(Self.collegeId)/groups"),
           let groups = try? JSONDecoder().decode([ApiGroup].self, from: data),
           let g = groups.first(where: { normalize($0.name) == normalize(Self.groupName) }) {
            id = g.studentGroupId
        }
        defaults.set(id, forKey: "group_id")
        return id
    }

    private func lastPublished(_ gid: Int) async -> Date? {
        guard let data = try? await Http.get("\(Self.base)/groups/\(gid)/schedules/last"),
              let d = try? JSONDecoder().decode(ApiDate.self, from: data).date else { return nil }
        return Tyumen.parseDay(d)
    }

    private func key(_ day: Date) -> String { "day_" + Tyumen.isoDay(day) }

    nonisolated func cached(_ day: Date) -> DayData? {
        let d = UserDefaults(suiteName: "schedule_cache") ?? .standard
        let k = "day_" + Tyumen.isoDay(day)
        guard let body = d.data(forKey: k), let lessons = try? ScheduleParser.lessons(from: body) else { return nil }
        let at = d.object(forKey: k + "_at") as? Date
        return DayData(lessons: lessons, offline: true, savedAt: at, notPublished: false)
    }

    func load(_ day: Date) async throws -> DayData {
        do {
            let gid = await groupId()
            let body = try await Http.get("\(Self.base)/groups/\(gid)/schedules?date=\(Tyumen.isoDay(day))")
            let lessons = try ScheduleParser.lessons(from: body)
            var notPublished = false
            if lessons.isEmpty, let last = await lastPublished(gid) {
                notPublished = Tyumen.startOfDay(day) > Tyumen.startOfDay(last)
            }
            var change: DayChange? = nil
            if !notPublished {
                let old = cached(day)
                let baseline = defaults.bool(forKey: "baseline")
                if baseline {
                    if old == nil { change = lessons.isEmpty ? nil : .published }
                    else if old!.lessons != lessons { change = .changed }
                }
                defaults.set(body, forKey: key(day))
                defaults.set(Date(), forKey: key(day) + "_at")
                defaults.set(true, forKey: "baseline")
            }
            return DayData(lessons: lessons, offline: false, savedAt: Date(), notPublished: notPublished, change: change)
        } catch {
            if let c = cached(day) { return c }
            throw error
        }
    }

    /// Пн–Сб текущей и следующей недели.
    nonisolated static func weeksToSync(_ today: Date) -> [Date] {
        let mon = Tyumen.monday(of: today)
        return (0..<2).flatMap { w in (0..<6).map { Tyumen.addDays(w * 7 + $0, to: mon) } }
    }

    /// Тихо обновляет кэш и возвращает изменения (только сегодня и дальше). nil — нет сети.
    func prefetch(_ days: [Date], today: Date) async -> [(Date, DayChange)]? {
        var any = false
        var changes: [(Date, DayChange)] = []
        for d in days {
            if let r = try? await load(d) {
                if !r.offline { any = true }
                if let c = r.change, Tyumen.startOfDay(d) >= Tyumen.startOfDay(today) { changes.append((d, c)) }
            }
        }
        cleanup(today)
        return any ? changes : nil
    }

    /// Удаляет дни старше двух недель — кэш не растёт.
    private func cleanup(_ today: Date) {
        let limit = Tyumen.addDays(-Self.keepDays, to: Tyumen.startOfDay(today))
        for k in defaults.dictionaryRepresentation().keys where k.hasPrefix("day_") {
            let dayStr = String(k.dropFirst(4).prefix(10))
            if let d = Tyumen.parseDay(dayStr), d < limit { defaults.removeObject(forKey: k) }
        }
    }

    func clearCache() {
        let keep = defaults.integer(forKey: "group_id")
        for k in defaults.dictionaryRepresentation().keys { defaults.removeObject(forKey: k) }
        if keep > 0 { defaults.set(keep, forKey: "group_id") }
    }
}
