import Foundation
import TkpstCore
import UserNotifications
import WidgetKit

/// Напоминание за 10 минут до первой очной пары. Ставится заранее на неделю вперёд
/// по сохранённому расписанию и пересоздаётся после каждой синхронизации.
enum PairReminder {
    private static let key = "reminder_first_pair"
    private static let minutesBefore = 10
    private static let ids = (0..<7).map { "first-pair-\($0)" }

    static var enabled: Bool {
        get { UserDefaults.standard.object(forKey: key) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }

    @MainActor
    static func reschedule() {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: ids)
        guard enabled else { return }
        let now = Date()
        for offset in 0..<ids.count {
            let day = Tyumen.addDays(offset, to: now)
            guard let data = ScheduleRepository.shared.cached(day),
                  let first = DayState.firstInPerson(OverridesStore.shared.build(day, data.lessons)) else { continue }
            let fire = Tyumen.at(day, minutes: first.start - minutesBefore)
            guard fire > now else { continue }
            let content = UNMutableNotificationContent()
            content.title = "Через \(minutesBefore) минут: \(EntryText.kind(first)) в \(Tyumen.hm(minutes: first.start))"
            content.body = [EntryText.title(first), EntryText.cabinet(first)].filter { !$0.isEmpty }.joined(separator: ", ")
            content.sound = .default
            content.userInfo = ["open": "schedule"]
            // Момент задан в поясе телефона: напоминание придёт вовремя, даже если пояс не тюменский.
            let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: fire)
            let trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
            center.add(UNNotificationRequest(identifier: ids[offset], content: content, trigger: trigger))
        }
    }

    /// Обновляет расписание на телефоне, затем напоминания и виджет.
    static func refreshEverything() async {
        let today = Date()
        await OverridesStore.shared.refresh()
        _ = await ScheduleRepository.shared.prefetch(ScheduleRepository.weeksToSync(today), today: today)
        await reschedule()
        WidgetCenter.shared.reloadAllTimelines()
    }
}
