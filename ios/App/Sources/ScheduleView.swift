import SwiftUI
import TkpstCore

enum DayState {
    case loading
    case loaded(entries: [TkpstCore.Entry], data: DayData)
    case error(String)
}

@MainActor
final class ScheduleVM: ObservableObject {
    private let repo = ScheduleRepository.shared

    @Published private(set) var selected: Date
    @Published private(set) var weekStart: Date
    @Published private(set) var state: DayState = .loading
    @Published private(set) var refreshing = false

    private var loadTask: Task<Void, Never>?
    private var prefetchTask: Task<Void, Never>?

    static func today() -> Date { Tyumen.startOfDay(Date()) }

    init() {
        let t = Self.today()
        selected = t
        weekStart = Tyumen.monday(of: t)
    }

    /// При каждом открытии: обновить выбранный день и докачать две недели.
    func onAppear() {
        load(selected)
        if prefetchTask == nil {
            prefetchTask = Task {
                let t = Date()
                let before = OverridesStore.shared.data
                let admin = await OverridesStore.shared.refresh() ?? []
                if OverridesStore.shared.data != before { rebuild() }
                let days = ScheduleRepository.weeksToSync(t).filter { Tyumen.isoDay($0) != Tyumen.isoDay(selected) }
                let changes = await repo.prefetch(days, today: t) ?? []
                ScheduleNotifier.notify(admin + changes)
                prefetchTask = nil
            }
        }
    }

    func select(_ day: Date) {
        selected = Tyumen.startOfDay(day)
        weekStart = Tyumen.monday(of: selected)
        load(selected)
    }

    func shiftWeek(_ n: Int) {
        let newStart = Tyumen.addDays(7 * n, to: weekStart)
        let t = Self.today()
        let offset = Tyumen.weekday(selected) == 7 ? 0 : Tyumen.weekday(selected) - 1
        if Tyumen.monday(of: t) == newStart && Tyumen.weekday(t) != 7 { select(t) }
        else { select(Tyumen.addDays(offset, to: newStart)) }
    }

    func goToday() { select(Self.today()) }

    /// Перестроить ленту после изменений из админ-панели.
    private func rebuild() {
        if case let .loaded(_, data) = state, Tyumen.weekday(selected) != 7 {
            state = .loaded(entries: OverridesStore.shared.build(selected, data.lessons), data: data)
        }
    }

    func refresh() { load(selected, userRefresh: true) }

    private func load(_ day: Date, userRefresh: Bool = false) {
        loadTask?.cancel()
        let wd = Tyumen.weekday(day)
        if wd == 7 {
            state = .loaded(entries: [], data: DayData(lessons: [], offline: false, savedAt: nil, notPublished: false))
            return
        }
        // Сначала мгновенно показываем кэш, потом обновляем из сети.
        if let c = repo.cached(day) {
            state = .loaded(entries: OverridesStore.shared.build(day, c.lessons), data: c)
            refreshing = true
        } else {
            state = .loading
            refreshing = userRefresh
        }
        loadTask = Task {
            do {
                let d = try await repo.load(day)
                if Task.isCancelled { return }
                state = .loaded(entries: OverridesStore.shared.build(day, d.lessons), data: d)
            } catch {
                if Task.isCancelled { return }
                if let c = repo.cached(day) {
                    state = .loaded(entries: OverridesStore.shared.build(day, c.lessons), data: c)
                } else {
                    state = .error("Нет соединения с сервером расписания")
                }
            }
            refreshing = false
        }
    }
}

private enum Phase { case past, now, future, otherDay }

struct ScheduleView: View {
    @StateObject private var vm = ScheduleVM()
    @ObservedObject private var overrides = OverridesStore.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            let now = ctx.date
            let today = Tyumen.startOfDay(now)
            VStack(spacing: 0) {
                weekBar(today: today)
                content(now: now, today: today)
            }
            .background(Palette.background.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text("Расписание").font(.headline)
                        Text("ИС-25-3С · сейчас \(Tyumen.hm(now))").font(.caption).foregroundStyle(Palette.muted)
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    if vm.refreshing { ProgressView() } else {
                        Button { vm.refresh() } label: { Image(systemName: "arrow.clockwise") }
                    }
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { vm.onAppear() }
        .onChange(of: scenePhase) { p in if p == .active { vm.onAppear() } }
    }

    // MARK: - Неделя

    @ViewBuilder
    private func weekBar(today: Date) -> some View {
        VStack(spacing: 8) {
            HStack {
                Button { vm.shiftWeek(-1) } label: { Image(systemName: "chevron.left").padding(8) }
                Spacer()
                Text("\(Tyumen.format(vm.weekStart, "d MMM")) – \(Tyumen.format(Tyumen.addDays(5, to: vm.weekStart), "d MMM"))")
                    .font(.headline)
                Spacer()
                Button { vm.shiftWeek(1) } label: { Image(systemName: "chevron.right").padding(8) }
            }
            HStack(spacing: 6) {
                ForEach(0..<6, id: \.self) { i in
                    let d = Tyumen.addDays(i, to: vm.weekStart)
                    DayChip(name: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб"][i],
                            day: Tyumen.calendar.component(.day, from: d),
                            selected: Tyumen.isoDay(d) == Tyumen.isoDay(vm.selected),
                            isToday: Tyumen.isoDay(d) == Tyumen.isoDay(today))
                        .onTapGesture { vm.select(d) }
                }
            }
            Group {
                if Tyumen.isoDay(vm.selected) != Tyumen.isoDay(today) {
                    Button(Tyumen.weekday(today) == 7 ? "К сегодня (воскресенье)" : "К сегодняшнему дню") { vm.goToday() }
                        .font(.subheadline)
                } else {
                    Text(" ").font(.subheadline)
                }
            }
            .frame(height: 28)
        }
        .padding(.horizontal, 12)
        .padding(.top, 4)
    }

    // MARK: - День

    @ViewBuilder
    private func content(now: Date, today: Date) -> some View {
        if Tyumen.weekday(vm.selected) == 7 {
            CenterMessage(title: "Выходной", text: "В воскресенье пар нет. Отдыхай 🙂")
        } else {
            switch vm.state {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .error(let msg):
                CenterMessage(title: "Не удалось загрузить", text: msg, action: "Повторить") { vm.refresh() }
            case let .loaded(entries, data):
                if entries.isEmpty {
                    VStack(spacing: 8) {
                        adminNotes.padding(.horizontal, 16)
                        if data.notPublished {
                            CenterMessage(title: "Расписания ещё нет", text: "Колледж пока не опубликовал пары на этот день.")
                        } else {
                            CenterMessage(title: "Пар нет", text: "На этот день занятий не найдено.")
                        }
                    }
                } else {
                    dayList(entries: entries, data: data, now: now, today: today)
                }
            }
        }
    }

    private func dayList(entries: [TkpstCore.Entry], data: DayData, now: Date, today: Date) -> some View {
        let isToday = Tyumen.isoDay(vm.selected) == Tyumen.isoDay(today)
        let nowMin = Tyumen.minuteOfDay(now)
        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 8) {
                    if data.offline {
                        Text("Нет сети — показано сохранённое расписание" +
                             (data.savedAt.map { " (\(Tyumen.format($0, "d MMM, HH:mm")))" } ?? ""))
                            .font(.caption)
                            .card(fill: Palette.tertiaryContainer, stroke: nil, radius: 12)
                    }
                    adminNotes
                    if isToday { summary(entries, nowMin: nowMin) }
                    ForEach(entries) { e in
                        let phase: Phase = !isToday ? .otherDay
                            : (nowMin >= Double(e.end) ? .past : (nowMin >= Double(e.start) ? .now : .future))
                        entryView(e, phase: phase, nowMin: nowMin).id(e.id)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .onAppear {
                if isToday, let cur = entries.first(where: { nowMin < Double($0.end) }) {
                    proxy.scrollTo(cur.id, anchor: .top)
                }
            }
        }
    }

    @ViewBuilder
    private var adminNotes: some View {
        if !overrides.announcement.isEmpty { AnnouncementCard(text: overrides.announcement) }
        let note = overrides.note(vm.selected)
        if !note.isEmpty {
            Text(note).font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
                .foregroundStyle(Palette.onTertiaryContainer)
                .card(fill: Palette.tertiaryContainer, stroke: nil, radius: 16)
        }
    }

    private func summary(_ entries: [TkpstCore.Entry], nowMin: Double) -> some View {
        let first = Double(entries.first!.start), last = entries.last!.end
        let text: String
        if nowMin < first { text = "До начала занятий \(Timeline.formatLeft(Int((first - nowMin) * 60)))" }
        else if nowMin >= Double(last) { text = "Занятия на сегодня закончились" }
        else { text = "Занятия закончатся через \(Timeline.formatLeft(Int((Double(last) - nowMin) * 60))) (в \(Tyumen.hm(minutes: last)))" }
        return Text(text).font(.subheadline).foregroundStyle(Palette.muted)
            .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 4)
    }

    @ViewBuilder
    private func entryView(_ e: TkpstCore.Entry, phase: Phase, nowMin: Double) -> some View {
        switch e {
        case let .pair(number, start, end, lessons, status):
            PairCard(number: number, start: start, end: end, lessons: lessons, status: status, phase: phase, nowMin: nowMin)
        case let .classHour(start, end, title, cabinet):
            ClassHourCard(start: start, end: end, title: title, cabinet: cabinet, phase: phase, nowMin: nowMin)
        case let .pause(start, end, kind):
            BreakCard(start: start, end: end, kind: kind, phase: phase, nowMin: nowMin)
        }
    }
}

// MARK: - Карточки

private func secondsLeft(_ target: Int, _ nowMin: Double) -> Int { Int(((Double(target) - nowMin) * 60).rounded(.up)) }

private func progress(_ start: Int, _ end: Int, _ nowMin: Double) -> Double {
    end <= start ? 1 : (nowMin - Double(start)) / Double(end - start)
}

private struct TimerLine: View {
    let start: Int
    let end: Int
    let phase: Phase
    let nowMin: Double
    var body: some View {
        switch phase {
        case .future:
            Text("Начнётся через \(Timeline.formatLeft(secondsLeft(start, nowMin)))")
                .font(.subheadline.weight(.medium)).foregroundStyle(Palette.primary)
        case .now:
            VStack(alignment: .leading, spacing: 6) {
                Text("Закончится через \(Timeline.formatLeft(secondsLeft(end, nowMin)))")
                    .font(.subheadline.weight(.bold)).foregroundStyle(Palette.primary)
                ProgressBar(value: progress(start, end, nowMin))
            }
        case .past:
            Text("Прошла").font(.caption).foregroundStyle(Palette.muted)
        case .otherDay:
            EmptyView()
        }
    }
}

private struct DayChip: View {
    let name: String
    let day: Int
    let selected: Bool
    let isToday: Bool
    var body: some View {
        VStack(spacing: 2) {
            Text(name).font(.caption)
            Text("\(day)").font(.headline)
            Circle().fill(isToday ? (selected ? Palette.onPrimary : Palette.primary) : .clear).frame(width: 5, height: 5)
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: 16).fill(selected ? Palette.primary : Palette.cardHigh))
        .overlay { if isToday && !selected { RoundedRectangle(cornerRadius: 16).stroke(Palette.primary, lineWidth: 2) } }
        .foregroundStyle(selected ? Palette.onPrimary : Palette.onSurface)
        .contentShape(Rectangle())
    }
}

private struct PairCard: View {
    let number: Int
    let start: Int
    let end: Int
    let lessons: [LessonInfo]
    let status: PairStatus
    let phase: Phase
    let nowMin: Double

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 0) {
                Text("\(number)").font(.title.weight(.bold)).foregroundStyle(Palette.primary)
                Text("пара").font(.caption2).foregroundStyle(Palette.muted)
            }
            .frame(width: 44)
            VStack(alignment: .leading, spacing: 4) {
                Text("\(Tyumen.hm(minutes: start)) – \(Tyumen.hm(minutes: end))")
                    .font(.subheadline.weight(.medium)).foregroundStyle(Palette.muted)
                if status == .cancelled {
                    Text("Пара отменена").font(.caption.weight(.semibold))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.red.opacity(0.15)))
                        .foregroundStyle(Color.red)
                }
                if status == .remote {
                    Text("Дистант · в колледж идти не нужно").font(.caption.weight(.semibold))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Palette.tertiaryContainer))
                        .foregroundStyle(Palette.onTertiaryContainer)
                }
                ForEach(Array(lessons.enumerated()), id: \.offset) { i, l in
                    LessonBlock(l, struck: status == .cancelled).padding(.top, i > 0 ? 6 : 0)
                }
                if status != .cancelled {
                    TimerLine(start: start, end: end, phase: phase, nowMin: nowMin).padding(.top, 4)
                }
            }
        }
        .card(fill: phase == .now ? Palette.primaryContainer : Palette.card,
              stroke: phase == .now ? Palette.primary : Palette.outline,
              lineWidth: phase == .now ? 2 : 1)
        .opacity(phase == .past ? 0.5 : 1)
    }
}

private struct LessonBlock: View {
    let l: LessonInfo
    let struck: Bool
    init(_ l: LessonInfo, struck: Bool = false) { self.l = l; self.struck = struck }
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if l.added { Badge(text: "Добавлена") }
            if l.replaced {
                Badge(text: "Замена")
                if let old = l.oldTitle { Text(old).font(.caption).foregroundStyle(Palette.muted).strikethrough() }
            }
            Text(l.title.isEmpty ? "Без названия" : l.title).font(.headline)
                .strikethrough(struck)
                .foregroundStyle(struck ? Palette.muted : Palette.onSurface)
            HStack(spacing: 6) {
                if let oc = l.oldCabinet, !oc.isEmpty { Text("каб. \(oc)").strikethrough().foregroundStyle(Palette.muted) }
                Text(l.cabinet.isEmpty ? "Кабинет не указан" : "Кабинет \(l.cabinet)")
            }
            .font(.subheadline)
            if let ot = l.oldTeacher, !ot.isEmpty { Text(ot).font(.subheadline).strikethrough().foregroundStyle(Palette.muted) }
            if !l.teacher.isEmpty { Text(l.teacher).font(.subheadline).foregroundStyle(Palette.muted) }
        }
    }
}

private struct ClassHourCard: View {
    let start: Int
    let end: Int
    let title: String
    let cabinet: String
    let phase: Phase
    let nowMin: Double
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Классный час · \(Tyumen.hm(minutes: start)) – \(Tyumen.hm(minutes: end))").font(.subheadline.weight(.medium))
            Text(title).font(.headline)
            if !cabinet.isEmpty { Text("Кабинет \(cabinet)").font(.subheadline) }
            TimerLine(start: start, end: end, phase: phase, nowMin: nowMin).padding(.top, 2)
        }
        .foregroundStyle(Palette.onTertiaryContainer)
        .card(fill: Palette.tertiaryContainer, stroke: phase == .now ? Palette.tertiary : nil, lineWidth: 2)
        .opacity(phase == .past ? 0.5 : 1)
    }
}

private struct BreakCard: View {
    let start: Int
    let end: Int
    let kind: BreakKind
    let phase: Phase
    let nowMin: Double
    var body: some View {
        let minutes = end - start
        let label: String = {
            switch kind {
            case .short: return "Перерыв \(minutes) мин"
            case .big: return "Большой перерыв \(minutes) мин"
            case .window: return "Окно · \(Timeline.formatLeft(minutes * 60))"
            }
        }()
        let active = phase == .now
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label).font(.subheadline.weight(.medium))
                Spacer()
                Text("\(Tyumen.hm(minutes: start))–\(Tyumen.hm(minutes: end))").font(.caption).foregroundStyle(Palette.muted)
            }
            if active {
                Text("Закончится через \(Timeline.formatLeft(secondsLeft(end, nowMin)))")
                    .font(.subheadline.weight(.bold)).foregroundStyle(Palette.primary)
                ProgressBar(value: progress(start, end, nowMin), height: 4)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 14).fill(active ? Palette.secondaryContainer : .clear))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(active ? Palette.primary : Palette.outline, lineWidth: 1))
        .padding(.horizontal, 24)
        .opacity(phase == .past ? 0.5 : 1)
    }
}

/// Объявление из админ-панели.
struct AnnouncementCard: View {
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Объявление").font(.subheadline.weight(.bold))
            Text(text).font(.subheadline)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .foregroundStyle(Palette.onPrimaryContainer)
        .card(fill: Palette.primaryContainer, stroke: nil, radius: 16)
    }
}
