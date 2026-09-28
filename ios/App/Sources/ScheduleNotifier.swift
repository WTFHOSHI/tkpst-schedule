import Foundation
import TkpstCore
import UserNotifications

/// Уведомления о новом и изменённом расписании.
enum ScheduleNotifier {
    static func requestPermissionOnce() {
        let key = "asked_notifications"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        UserDefaults.standard.set(true, forKey: key)
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    static func notify(_ changes: [(Date, DayChange)]) {
        guard !changes.isEmpty else { return }
        let published = changes.filter { $0.1 == .published }.map { $0.0 }.sorted()
        let changed = changes.filter { $0.1 == .changed }.map { $0.0 }.sorted()
        let fmt: (Date) -> String = { Tyumen.format($0, "EE d MMM") }
        if let first = published.first, let last = published.last {
            let text = published.count == 1 ? fmt(first) : "\(fmt(first)) – \(fmt(last))"
            post(id: "published", title: "Вышло новое расписание", body: "ИС-25-3С: \(text)")
        }
        if !changed.isEmpty {
            post(id: "changed", title: "Изменения в расписании", body: "ИС-25-3С: " + changed.map(fmt).joined(separator: ", "))
        }
    }

    private static func post(id: String, title: String, body: String) {
        let c = UNMutableNotificationContent()
        c.title = title
        c.body = body
        c.sound = .default
        c.userInfo = ["open": "schedule"]
        let req = UNNotificationRequest(identifier: id, content: c, trigger: nil)
        UNUserNotificationCenter.current().add(req)
    }
}
