import SwiftUI
import TkpstCore
import WidgetKit

struct PairEntry: TimelineEntry {
    let date: Date
    let state: NowState
    /// Начало суток (по Тюмени), от которых отсчитаны минуты и смещения дней в `state`.
    let day: Date
}

struct PairProvider: TimelineProvider {
    func placeholder(in context: Context) -> PairEntry {
        PairEntry(date: Date(), state: .free, day: Tyumen.startOfDay(Date()))
    }

    func getSnapshot(in context: Context, completion: @escaping (PairEntry) -> Void) {
        Task { completion(await Self.entries(now: Date()).first ?? placeholder(in: context)) }
    }

    func getTimeline(in context: Context, completion: @escaping (WidgetKit.Timeline<PairEntry>) -> Void) {
        Task {
            let now = Date()
            // Записи заранее расставлены на все границы пар и перерывов, поэтому виджет
            // переключается сам; раз в полтора часа расписание перечитывается из сети.
            completion(WidgetKit.Timeline(entries: await Self.entries(now: now), policy: .after(now.addingTimeInterval(90 * 60))))
        }
    }

    /// Ленты дней: сегодня и дальше, пока не найдётся день с занятиями (не больше недели).
    private static func loadDays(from day: Date) async -> [[TkpstCore.Entry]] {
        await OverridesStore.shared.refresh()
        var days: [[TkpstCore.Entry]] = []
        for offset in 0...7 {
            let date = Tyumen.addDays(offset, to: day)
            let lessons = (try? await ScheduleRepository.shared.load(date))?.lessons ?? []
            let entries = await OverridesStore.shared.build(date, lessons)
            days.append(entries)
            if offset > 0, entries.contains(where: DayState.isLesson) { break }
        }
        return days
    }

    static func entries(now: Date) async -> [PairEntry] {
        let day = Tyumen.startOfDay(now)
        let days = await loadDays(from: day)
        let lookup: (Int) -> [TkpstCore.Entry] = { $0 < days.count ? days[$0] : [] }
        let minute = Int(Tyumen.minuteOfDay(now))
        var result = [PairEntry(date: now, state: DayState.at(minute: minute, days: lookup), day: day)]
        for boundary in DayState.boundaries(days.first ?? []) where boundary > minute {
            result.append(PairEntry(date: Tyumen.at(day, minutes: boundary), state: DayState.at(minute: boundary, days: lookup), day: day))
        }
        // После полуночи «завтра» становится «сегодня».
        let tomorrow = Tyumen.addDays(1, to: day)
        let later: (Int) -> [TkpstCore.Entry] = { $0 + 1 < days.count ? days[$0 + 1] : [] }
        result.append(PairEntry(date: tomorrow, state: DayState.at(minute: 0, days: later), day: tomorrow))
        return result
    }
}

struct PairWidgetView: View {
    let entry: PairEntry
    @Environment(\.widgetFamily) private var family

    private static let accent = Color(UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(red: 0.70, green: 0.83, blue: 0.56, alpha: 1) : UIColor(red: 0.25, green: 0.37, blue: 0.13, alpha: 1) })
    private static let surface = Color(UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(red: 0.11, green: 0.12, blue: 0.09, alpha: 1) : UIColor(red: 0.93, green: 0.95, blue: 0.90, alpha: 1) })

    private struct Content {
        var label = "ИС-25-3С"
        var title = "Пар в ближайшие дни нет"
        var span = ""
        var until: Date?
        var timerLabel = ""
        var next = ""
    }

    private var content: Content {
        var c = Content()
        switch entry.state {
        case let .current(e, next):
            c.label = "Сейчас: \(EntryText.kind(e))"
            c.title = EntryText.title(e)
            c.span = EntryText.span(e)
            c.until = Tyumen.at(entry.day, minutes: e.end)
            c.timerLabel = "до конца"
            if let next {
                var parts = [EntryText.kind(next)]
                if case .pause = next { parts.append(DayState.duration(next.end - next.start)) } else { parts.append(EntryText.title(next)) }
                parts.append(EntryText.cabinet(next))
                c.next = "Далее: " + parts.filter { !$0.isEmpty }.joined(separator: ", ")
            } else {
                c.next = "Последнее занятие на сегодня"
            }
        case let .upcoming(e, offset):
            let date = Tyumen.addDays(offset, to: entry.day)
            let when = offset == 0 ? "сегодня" : offset == 1 ? "завтра" : Tyumen.format(date, "EE, d MMM")
            c.label = "Следующая: \(EntryText.kind(e)), \(when)"
            c.title = EntryText.title(e)
            c.span = EntryText.span(e)
            let start = Tyumen.at(date, minutes: e.start)
            // Обратный отсчёт имеет смысл, пока до начала меньше суток.
            if start.timeIntervalSince(entry.date) < 24 * 3600 {
                c.until = start
                c.timerLabel = "до начала"
            }
        case .free:
            c.span = "Если расписание уже вышло, откройте приложение"
        }
        return c
    }

    var body: some View {
        let c = content
        // Цвета темы, выбранной в приложении; без них — системные светлые или тёмные.
        let theme = SharedTheme.load()
        let surface = theme.map { Color($0[0]) } ?? Self.surface
        let text = theme.map { Color($0[1]) } ?? Color.primary
        let muted = theme.map { Color($0[2]) } ?? Color.secondary
        let accent = theme.map { Color($0[3]) } ?? Self.accent
        VStack(alignment: .leading, spacing: 3) {
            Text(c.label).font(.caption.weight(.semibold)).foregroundColor(accent).lineLimit(1)
            Text(c.title).font(.headline).foregroundColor(text).lineLimit(family == .systemSmall ? 3 : 2).minimumScaleFactor(0.8)
            if !c.span.isEmpty { Text(c.span).font(.caption).foregroundColor(text).lineLimit(2) }
            if let until = c.until {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(until, style: .timer).font(.title3.weight(.bold)).monospacedDigit()
                        .foregroundColor(accent).multilineTextAlignment(.leading).fixedSize()
                    Text(c.timerLabel).font(.caption2).foregroundColor(muted)
                }
            }
            if !c.next.isEmpty, family != .systemSmall {
                Text(c.next).font(.caption2).foregroundColor(muted).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .widgetSurface(surface)
    }
}

private extension View {
    @ViewBuilder
    func widgetSurface(_ color: Color) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(color, for: .widget)
        } else {
            padding().background(color)
        }
    }
}

@main
struct NextPairWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NextPair", provider: PairProvider()) { entry in
            PairWidgetView(entry: entry)
        }
        .configurationDisplayName("Текущая и следующая пара")
        .description("Что идёт сейчас, когда закончится и что дальше.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
