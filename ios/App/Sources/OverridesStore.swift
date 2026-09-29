import Foundation
import TkpstCore

/// Изменения из админ-панели: скачиваются с сайта, хранятся на телефоне — обновлять приложение не нужно.
@MainActor
final class OverridesStore: ObservableObject {
    static let shared = OverridesStore()
    static let url = "https://wtfhoshi.github.io/tkpst-schedule/overrides.json"
    private let key = "overrides_json"

    @Published private(set) var data = OverridesData()

    private init() {
        if let raw = UserDefaults.standard.data(forKey: key),
           let d = try? JSONDecoder().decode(OverridesData.self, from: raw) {
            data = d
        }
    }

    var announcement: String { (data.announcement ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
    func note(_ day: Date) -> String {
        (data.day(Tyumen.isoDay(day))?.note ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Скачать свежую версию. Возвращает изменившиеся дни (сегодня и дальше) или nil без сети.
    @discardableResult
    func refresh() async -> [(Date, DayChange)]? {
        guard let raw = try? await Http.get("\(Self.url)?t=\(Int(Date().timeIntervalSince1970 * 1000))", timeout: 10),
              let fresh = try? JSONDecoder().decode(OverridesData.self, from: raw) else { return nil }
        let old = data
        if fresh == old { return [] }
        let hadBaseline = UserDefaults.standard.data(forKey: key) != nil
        UserDefaults.standard.set(raw, forKey: key)
        data = fresh
        guard hadBaseline else { return [] }
        let today = Tyumen.isoDay(Date())
        return fresh.changedDays(comparedTo: old)
            .filter { $0 >= today }
            .compactMap { iso in Tyumen.parseDay(iso).map { ($0, DayChange.changed) } }
    }

    func build(_ day: Date, _ lessons: [ApiLesson]) -> [TkpstCore.Entry] {
        Timeline.build(weekday: Tyumen.weekday(day), lessons: lessons, day: Tyumen.isoDay(day), overrides: data)
    }
}
