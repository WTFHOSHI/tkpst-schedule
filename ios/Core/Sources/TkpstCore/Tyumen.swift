import Foundation

/// Всё приложение живёт по времени Тюмени (UTC+5), независимо от пояса телефона.
public enum Tyumen {
    public static let timeZone = TimeZone(identifier: "Asia/Yekaterinburg")!

    public static var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = timeZone
        c.firstWeekday = 2
        c.locale = Locale(identifier: "ru_RU")
        return c
    }

    /// Начало суток (00:00 по Тюмени) для даты.
    public static func startOfDay(_ date: Date) -> Date { calendar.startOfDay(for: date) }

    /// 1 = понедельник … 7 = воскресенье.
    public static func weekday(_ date: Date) -> Int {
        let w = calendar.component(.weekday, from: date) // 1 = воскресенье
        return w == 1 ? 7 : w - 1
    }

    /// Понедельник недели, в которую входит дата.
    public static func monday(of date: Date) -> Date {
        let d = startOfDay(date)
        return calendar.date(byAdding: .day, value: -(weekday(d) - 1), to: d)!
    }

    public static func addDays(_ n: Int, to date: Date) -> Date {
        calendar.date(byAdding: .day, value: n, to: date)!
    }

    /// Минуты от начала суток по Тюмени.
    public static func minuteOfDay(_ date: Date) -> Double {
        let c = calendar.dateComponents([.hour, .minute, .second], from: date)
        return Double((c.hour ?? 0) * 60 + (c.minute ?? 0)) + Double(c.second ?? 0) / 60
    }

    /// Дата + минуты от начала суток.
    public static func at(_ day: Date, minutes: Int) -> Date {
        startOfDay(day).addingTimeInterval(TimeInterval(minutes * 60))
    }

    public static func isoDay(_ date: Date) -> String {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    public static func parseDay(_ s: String) -> Date? {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: String(s.prefix(10)))
    }

    public static func format(_ date: Date, _ pattern: String) -> String {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = timeZone
        f.locale = Locale(identifier: "ru_RU")
        f.dateFormat = pattern
        return f.string(from: date)
    }

    public static func hm(_ date: Date) -> String { format(date, "HH:mm") }

    public static func hm(minutes: Int) -> String { String(format: "%02d:%02d", minutes / 60, minutes % 60) }
}
