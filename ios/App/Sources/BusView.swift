import SwiftUI
import TkpstCore

enum Direction: String, CaseIterable, Identifiable {
    case toCollege, toHome
    var id: String { rawValue }
    var title: String { self == .toCollege ? "В колледж" : "Домой" }
}

struct RouteArrivals: Identifiable {
    let routeName: String
    let times: [Date]
    let useful: Bool
    var id: String { routeName }
}

struct StopBoard: Identifiable {
    let stop: Stop
    let walk: Walk
    let arrivals: [RouteArrivals]
    var id: Int { stop.id }
}

/// Когда ехать — как в 2ГИС.
enum WhenMode: String, CaseIterable, Identifiable {
    case now, depart, arrive
    var id: String { rawValue }
    var title: String {
        switch self { case .now: return "Сейчас"; case .depart: return "Выехать в"; case .arrive: return "Приехать к" }
    }
}

/// day: 0 — сегодня, 1 — завтра; minutes — время суток по Тюмени.
struct WhenSpec: Equatable {
    var mode: WhenMode = .now
    var day: Int = 0
    var minutes: Int = 8 * 60

    func target(now: Date = Date()) -> Date {
        Tyumen.at(Tyumen.addDays(day, to: Tyumen.startOfDay(now)), minutes: minutes)
    }
}

/// Подсказка «к 1-й паре» / «после пар».
struct QuickWhen { let spec: WhenSpec; let label: String }

struct BusReady {
    let journeys: [Journey]
    let boards: [StopBoard]
    let updatedAt: Date
    let noStopsNearby: Bool
    var spec = WhenSpec()
    /// Выбранный момент для «выехать в» / «приехать к».
    var target: Date? = nil
    /// «Приехать к» уже прошло.
    var past = false
    /// Сервер не ответил — время взято из сохранённого графика.
    var usedSaved = false
}

enum BusState {
    case noHome
    case loadingNetwork(Int, Int)
    case searching
    case ready(BusReady)
    case error(String)
}

/// Когда сервер Тюменьгортранса не отвечает и в архиве на телефоне ещё нет графика этих остановок.
let serverDownText = "Сервер Тюменьгортранса сейчас не отвечает, а сохранённого графика для этих остановок на телефоне пока нет. " +
    "Попробуй позже — после первого удачного поиска график сохранится и будет работать даже без сервера."

@MainActor
final class BusVM: ObservableObject {
    private let transit = TransitRepository.shared
    @Published var direction: Direction
    @Published var sort: RouteSort = .duration
    @Published private(set) var state: BusState = .searching
    @Published private(set) var refreshing = false
    @Published private(set) var whenSpec = WhenSpec()

    private var task: Task<Void, Never>?
    private var plansKey: String?
    private var plans: [Plan] = []
    private var lastRefresh = Date.distantPast

    init() {
        // До конца сегодняшних пар — «В колледж», после — «Домой».
        let now = Date()
        let lessons = ScheduleRepository.shared.cached(now)?.lessons ?? []
        let entries = OverridesStore.shared.build(now, lessons).filter { $0.isInPerson }
        let end = Double(entries.last?.end ?? 14 * 60)
        direction = Tyumen.minuteOfDay(now) < end ? .toCollege : .toHome
    }

    /// Если выбранное время сегодня уже прошло — значит, имеется в виду завтра.
    private func normalized(_ spec: WhenSpec) -> WhenSpec {
        var s = spec
        if s.mode != .now && s.day == 0 && s.target() < Date() { s.day = 1 }
        return s
    }

    func setWhen(_ spec: WhenSpec) {
        let n = normalized(spec)
        guard n != whenSpec else { return }
        whenSpec = n
        refresh(spinner: true)
    }

    func selectMode(_ mode: WhenMode) {
        guard mode != whenSpec.mode else { return }
        var spec = whenSpec
        spec.mode = mode
        if whenSpec.mode == .now && mode != .now {
            // Разумное время по умолчанию: подсказка по расписанию или через час.
            if let q = quickWhen(), q.spec.mode == mode {
                spec = q.spec
            } else {
                let t = Date().addingTimeInterval(3600)
                let m = Int(Tyumen.minuteOfDay(t))
                spec.day = Tyumen.isoDay(t) != Tyumen.isoDay(Date()) ? 1 : 0
                spec.minutes = m / 5 * 5
            }
        }
        setWhen(spec)
    }

    /// К первой очной паре (в колледж) или после последней (домой) — сегодня или завтра.
    func quickWhen() -> QuickWhen? {
        let now = Date()
        for add in 0...1 {
            let day = Tyumen.addDays(add, to: Tyumen.startOfDay(now))
            if Tyumen.weekday(day) == 7 { continue }
            let lessons = ScheduleRepository.shared.cached(day)?.lessons ?? []
            let entries = OverridesStore.shared.build(day, lessons).filter { $0.isInPerson }
            guard let first = entries.first, let last = entries.last else { continue }
            let suffix = add == 1 ? " завтра" : ""
            if direction == .toCollege {
                if Tyumen.at(day, minutes: first.start) < now.addingTimeInterval(20 * 60) { continue }
                var title = "К классному часу"
                if case let .pair(n, _, _, _, _) = first { title = "К \(n)-й паре" }
                return QuickWhen(spec: WhenSpec(mode: .arrive, day: add, minutes: first.start - 5),
                                 label: "\(title) · \(Tyumen.hm(minutes: first.start))\(suffix)")
            } else {
                if Tyumen.at(day, minutes: last.end) < now { continue }
                return QuickWhen(spec: WhenSpec(mode: .depart, day: add, minutes: last.end + 5),
                                 label: "После пар · \(Tyumen.hm(minutes: last.end))\(suffix)")
            }
        }
        return nil
    }

    func select(_ d: Direction) {
        guard d != direction else { return }
        direction = d
        refresh(spinner: true)
    }

    func select(_ s: RouteSort) {
        guard s != sort else { return }
        sort = s
        refresh()
    }

    /// Таймер: «сейчас» — каждые 30 с, на выбранное время — раз в 2 минуты.
    func tick() {
        let every: TimeInterval = whenSpec.mode == .now ? 29 : 119
        if Date().timeIntervalSince(lastRefresh) >= every { refresh(force: true) }
    }

    func refresh(force: Bool = false, spinner: Bool = false) {
        guard let home = AppSettings.shared.home else { state = .noHome; return }
        task?.cancel()
        lastRefresh = Date()
        if spinner { state = .searching }
        if case .ready = state {} else { state = .searching }
        refreshing = true
        let dir = direction, sortMode = sort, spec = normalized(whenSpec)
        task = Task {
            if force { await transit.invalidateLive() }
            var netLoaded = false
            do {
                let net = try await transit.network { done, total in
                    Task { @MainActor [weak self] in
                        guard let self else { return }
                        if case .ready = self.state { return }
                        self.state = .loadingNetwork(done, total)
                    }
                }
                netLoaded = true
                if Task.isCancelled { return }
                let (from, to) = dir == .toCollege ? (home.point, Geo.college) : (Geo.college, home.point)
                let key = "\(net.data.date)|\(dir.rawValue)|\(home.point.lat),\(home.point.lon)"
                if key != plansKey {
                    if case .ready = state {} else { state = .searching }
                    plans = await Task.detached { Router.findPlans(net, from: from, to: to) }.value
                    plansKey = key
                }
                let result = await Self.compute(net: net, from: from, plans: plans, sort: sortMode, spec: spec)
                if Task.isCancelled { return }
                state = result
            } catch {
                if Task.isCancelled { return }
                state = .error(netLoaded ? "Не удалось получить данные об автобусах."
                               : "Не удалось загрузить маршруты города. Проверь интернет и попробуй ещё раз.")
            }
            refreshing = false
        }
    }

    private nonisolated static func compute(net: Network, from: LatLng, plans: [Plan], sort: RouteSort, spec: WhenSpec) async -> BusState {
        let now = Date()
        let repo = TransitRepository.shared
        let target: Date? = spec.mode == .now ? nil : spec.target(now: now)
        if plans.isEmpty {
            let b = spec.mode == .now ? await boards(net: net, from: from, journeys: [], now: now) : []
            return .ready(BusReady(journeys: [], boards: b, updatedAt: now,
                                   noStopsNearby: net.near(from, radius: Router.accessRadius).isEmpty, spec: spec, target: target))
        }
        if spec.mode == .arrive, let t = target, t < now.addingTimeInterval(300) {
            return .ready(BusReady(journeys: [], boards: [], updatedAt: now, noStopsNearby: false, spec: spec, target: target, past: true))
        }
        await repo.resetErrors()
        // Сначала параллельно берём онлайн-прогнозы для всех нужных остановок.
        let stopIds = Array(Set(plans.flatMap { $0.legs.map { $0.from.id } }))
        await withTaskGroup(of: Void.self) { g in
            for id in stopIds { g.addTask { _ = await repo.live(id) } }
        }
        let source = LiveDepartureSource()
        let base = spec.mode == .depart && (target ?? now) > now ? target! : now
        var journeys: [Journey] = []
        await withTaskGroup(of: Journey?.self) { g in
            for p in plans {
                g.addTask {
                    if spec.mode == .arrive, let t = target {
                        return await Router.arriveBy(p, deadline: t, earliest: now, source: source)
                    }
                    return await Router.schedule(p, now: base, source: source)
                }
            }
            for await j in g { if let j { journeys.append(j) } }
        }
        let ranked = Router.rank(journeys, sort: spec.mode == .arrive ? .latest : sort, now: base, take: 5)
        // «Ближайшие автобусы» имеют смысл только для «сейчас».
        let b = spec.mode == .now ? await boards(net: net, from: from, journeys: ranked, now: now) : []
        if ranked.isEmpty, await repo.hadNetworkErrors { return .error(serverDownText) }
        let usedSaved = await repo.usedSavedTimetable
        // Докачиваем и сохраняем график нужных остановок — чтобы поиск работал и без сервера.
        Task.detached(priority: .background) {
            await repo.prefetchTimetables(stopIds, day: now)
            await repo.prefetchTimetables(stopIds, day: Tyumen.addDays(1, to: now))
        }
        return .ready(BusReady(journeys: ranked, boards: b, updatedAt: now, noStopsNearby: false,
                               spec: spec, target: target, usedSaved: usedSaved))
    }

    /// «Ближайшие автобусы» на 2–3 остановках рядом с точкой отправления.
    private nonisolated static func boards(net: Network, from: LatLng, journeys: [Journey], now: Date) async -> [StopBoard] {
        let near = net.near(from, radius: Router.accessRadius)
        var useful = Set<String>()
        for j in journeys {
            useful.insert(j.legs[0].leg.routeName)
            if j.legs.count == 1 { useful.formUnion(j.alternatives) }
        }
        let names = net.routeNames
        func routesAt(_ id: Int) -> Set<String> { Set((net.byStop[id] ?? []).map { net.patterns[$0.0].routeName }) }

        var chosen: [Stop] = []
        for j in journeys where chosen.count < 3 {
            let s = j.legs[0].leg.from
            if !chosen.contains(where: { $0.id == s.id }) { chosen.append(s) }
        }
        var covered = chosen.reduce(into: Set<String>()) { $0.formUnion(routesAt($1.id)) }
        for (s, _) in near where chosen.count < 3 {
            if chosen.contains(where: { $0.id == s.id }) { continue }
            let r = routesAt(s.id)
            if chosen.count < 2 || !r.isSubset(of: covered) {
                chosen.append(s)
                covered.formUnion(r)
            }
        }
        var result: [StopBoard] = []
        for s in chosen {
            let live = await TransitRepository.shared.live(s.id)
            var grouped: [String: [Date]] = [:]
            for a in live where a.time >= now.addingTimeInterval(-60) { grouped[names[a.routeId] ?? "?", default: []].append(a.time) }
            let arrivals = grouped.map { RouteArrivals(routeName: $0.key, times: Array($0.value.sorted().prefix(3)), useful: useful.contains($0.key)) }
                .sorted { ($0.useful ? 0 : 1, $0.times.first ?? now) < ($1.useful ? 0 : 1, $1.times.first ?? now) }
            let d = Geo.distanceM(from, s)
            result.append(StopBoard(stop: s, walk: Walk(meters: Int(Geo.walkM(d)), minutes: Geo.walkMin(d)), arrivals: arrivals))
        }
        return result
    }
}

private func untilText(_ now: Date, _ t: Date) -> String {
    let s = Int(t.timeIntervalSince(now))
    return s <= 30 ? "сейчас" : "через \(Timeline.formatLeft(s))"
}

private func shortUntil(_ now: Date, _ t: Date) -> String {
    let s = Int(t.timeIntervalSince(now))
    return s < 60 ? "сейчас" : "\((s + 59) / 60) мин"
}

private func mins(_ m: Double) -> Int { max(1, Int(m)) }

struct BusView: View {
    @EnvironmentObject var settings: AppSettings
    @StateObject private var vm = BusVM()
    @Environment(\.scenePhase) private var scenePhase
    private let timer = Timer.publish(every: 15, on: .main, in: .common).autoconnect()

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            VStack(spacing: 0) {
                if let home = settings.home {
                    header(home: home)
                    content(now: ctx.date)
                } else {
                    CenterMessage(
                        title: "Укажи домашний адрес",
                        text: "Нужен, чтобы найти остановки рядом с домом и автобусы до колледжа и обратно. Адрес хранится только на телефоне."
                    )
                    NavigationLink(value: Route.address) { Text("Указать адрес") }
                        .buttonStyle(.borderedProminent)
                        .padding(.bottom, 48)
                }
            }
            .background(Palette.background.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text("Автобусы").font(.headline)
                        Text("Тюмень · сейчас \(Tyumen.hm(ctx.date))").font(.caption).foregroundStyle(Palette.muted)
                    }
                }
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    if vm.refreshing { ProgressView() } else {
                        Button { vm.refresh(force: true) } label: { Image(systemName: "arrow.clockwise") }
                    }
                    NavigationLink(value: Route.address) { Image(systemName: "house") }
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { vm.refresh(force: true) }
        .onReceive(timer) { _ in if scenePhase == .active { vm.tick() } }
        .onChange(of: settings.home) { _ in vm.refresh(force: true, spinner: true) }
        .onChange(of: scenePhase) { p in if p == .active { vm.refresh(force: true) } }
    }

    private func header(home: HomeAddress) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Направление", selection: Binding(get: { vm.direction }, set: { vm.select($0) })) {
                ForEach(Direction.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            Text(vm.direction == .toCollege ? "\(home.label) → \(Geo.collegeLabel)" : "\(Geo.collegeLabel) → \(home.label)")
                .font(.subheadline).foregroundStyle(Palette.muted).lineLimit(2)
            whenPicker
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
    }

    /// Когда ехать: сейчас / выехать в / приехать к (как в 2ГИС) + подсказка по расписанию.
    @ViewBuilder
    private var whenPicker: some View {
        let spec = vm.whenSpec
        HStack(spacing: 6) {
            ForEach(WhenMode.allCases) { m in
                chip(m.title, selected: spec.mode == m) { vm.selectMode(m) }
            }
        }
        if spec.mode != .now {
            HStack(spacing: 6) {
                chip("Сегодня", selected: spec.day == 0) { var s = spec; s.day = 0; vm.setWhen(s) }
                chip("Завтра", selected: spec.day == 1) { var s = spec; s.day = 1; vm.setWhen(s) }
                Spacer()
                DatePicker("Время", selection: Binding(
                    get: { Tyumen.at(Date(), minutes: spec.minutes) },
                    set: { d in var s = spec; s.minutes = Int(Tyumen.minuteOfDay(d)); vm.setWhen(s) }
                ), displayedComponents: .hourAndMinute)
                    .labelsHidden()
                    .environment(\.timeZone, Tyumen.timeZone)
                    .environment(\.locale, Locale(identifier: "ru_RU"))
            }
        }
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if let q = vm.quickWhen() {
                    Button { vm.setWhen(q.spec) } label: {
                        Text(q.label).font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .background(Capsule().fill(Palette.primaryContainer))
                            .foregroundStyle(Palette.onPrimaryContainer)
                    }
                    .buttonStyle(.plain)
                }
                if spec.mode != .arrive {
                    chip("Меньше в пути", selected: vm.sort == .duration) { vm.select(.duration) }
                    chip("Раньше приеду", selected: vm.sort == .arrival) { vm.select(.arrival) }
                }
            }
        }
    }

    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if selected { Image(systemName: "checkmark").font(.caption.weight(.bold)) }
                Text(title).font(.subheadline)
            }
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(Capsule().fill(selected ? Palette.secondaryContainer : .clear))
            .overlay(Capsule().stroke(Palette.outline))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func content(now: Date) -> some View {
        switch vm.state {
        case .noHome:
            EmptyView()
        case let .loadingNetwork(done, total):
            VStack(spacing: 12) {
                Text("Загружаю маршруты города").font(.headline)
                ProgressBar(value: total == 0 ? 0 : Double(done) / Double(total))
                Text("\(done) из \(total) · это делается один раз в день").foregroundStyle(Palette.muted)
            }
            .padding(32).frame(maxHeight: .infinity)
        case .searching:
            VStack(spacing: 12) { ProgressView(); Text("Ищу маршруты…").foregroundStyle(Palette.muted) }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .error(let msg):
            CenterMessage(title: "Ошибка", text: msg, action: "Повторить") { vm.refresh(force: true, spinner: true) }
        case let .ready(r):
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    if r.past {
                        info("Это время уже прошло или слишком близко. Выбери время позже или «Завтра».")
                    } else if r.journeys.isEmpty {
                        info(r.noStopsNearby ? "В радиусе километра нет остановок."
                             : r.spec.mode != .now ? "К этому времени подходящих рейсов не нашлось. Попробуй другое время."
                             : "Сейчас не нашлось автобусов по этому направлению (возможно, уже ночь). Посмотри ближайшие автобусы ниже.")
                    } else {
                        if r.spec.mode == .arrive, let t = r.target {
                            section("Чтобы успеть к \(Tyumen.hm(t))\(dayWord(t, now))")
                        } else if r.spec.mode == .depart, let t = r.target {
                            section("Выезд в \(Tyumen.hm(t))\(dayWord(t, now))")
                        } else {
                            section("Лучшие маршруты")
                        }
                        ForEach(r.journeys) {
                            JourneyCard(j: $0, now: now, direction: vm.direction, deadline: r.spec.mode == .arrive ? r.target : nil)
                        }
                    }
                    if !r.boards.isEmpty {
                        section("Ближайшие автобусы")
                        ForEach(r.boards) { StopBoardCard(b: $0, now: now) }
                    }
                    if r.usedSaved {
                        info("Сервер Тюменьгортранса сейчас не отвечает — время показано по сохранённому на телефоне графику, без онлайн-прогноза.")
                    }
                    Text("Обновлено в \(Tyumen.hm(r.updatedAt)) · онлайн-данные Тюменьгортранса, обновление каждые 30 с. Время в пути — примерное.")
                        .font(.caption).foregroundStyle(Palette.muted).padding(.top, 8)
                }
                .padding(.horizontal, 16).padding(.bottom, 24)
            }
        }
    }

    private func info(_ t: String) -> some View {
        Text(t).frame(maxWidth: .infinity, alignment: .leading).card(fill: Palette.cardHigh, stroke: nil, radius: 16)
    }

    private func section(_ t: String) -> some View {
        Text(t).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.primary).padding(.top, 8)
    }
}

private func dayWord(_ t: Date, _ now: Date) -> String {
    Tyumen.isoDay(t) > Tyumen.isoDay(now) ? " завтра" : ""
}

private struct JourneyCard: View {
    let j: Journey
    let now: Date
    let direction: Direction
    var deadline: Date? = nil

    var body: some View {
        let target = direction == .toCollege ? "колледжа" : "дома"
        let leaveSec = Int(j.leaveAt.timeIntervalSince(now))
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(j.durationMin) мин").font(.title2.weight(.bold))
                    Text(j.legs.count == 1 ? "в пути · без пересадок" : "в пути · 1 пересадка")
                        .font(.caption).foregroundStyle(Palette.muted)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("прибытие").font(.caption).foregroundStyle(Palette.muted)
                    Text(Tyumen.hm(j.arrive)).font(.headline)
                    if let d = deadline {
                        Text("запас \(max(0, Int(d.timeIntervalSince(j.arrive) / 60))) мин").font(.caption).foregroundStyle(Palette.muted)
                    }
                }
            }
            HStack(spacing: 6) {
                ForEach(Array(j.legs.enumerated()), id: \.offset) { i, l in
                    if i > 0 { Text("→").foregroundStyle(Palette.muted) }
                    RouteBadge(name: l.leg.routeName)
                }
                if !j.alternatives.isEmpty {
                    Text("или " + j.alternatives.prefix(5).map { "№\($0)" }.joined(separator: ", "))
                        .font(.caption).foregroundStyle(Palette.muted).lineLimit(2)
                }
            }
            Text(leaveSec <= 30 ? "Выходи сейчас"
                 : leaveSec > 3 * 3600 ? "Выходи в \(Tyumen.hm(j.leaveAt))\(dayWord(j.leaveAt, now))"
                 : "Выходи через \(Timeline.formatLeft(leaveSec)) (в \(Tyumen.hm(j.leaveAt)))")
                .font(.subheadline.weight(.bold))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 12).fill(Palette.primaryContainer))
                .foregroundStyle(Palette.onPrimaryContainer)

            Step(title: "Пешком \(mins(j.plan.walkStart.minutes)) мин · \(j.plan.walkStart.meters) м до «\(j.legs[0].leg.from.name)»",
                 subtitle: j.legs[0].leg.from.desc)
            ForEach(Array(j.legs.enumerated()), id: \.offset) { i, tl in
                if i > 0 {
                    if let tw = j.plan.transferWalk, tw.meters >= 30 {
                        Step(title: "Пересадка: пешком \(mins(tw.minutes)) мин · \(tw.meters) м до «\(tl.leg.from.name)»",
                             subtitle: tl.leg.from.desc)
                    } else {
                        Step(title: "Пересадка на той же остановке «\(tl.leg.from.name)»", subtitle: nil)
                    }
                }
                BusStep(tl: tl, now: now)
            }
            Step(title: "Пешком \(mins(j.plan.walkEnd.minutes)) мин · \(j.plan.walkEnd.meters) м до \(target)", subtitle: nil)
        }
        .card()
    }
}

private struct Step: View {
    let title: String
    let subtitle: String?
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle().fill(Palette.muted).frame(width: 6, height: 6).padding(.top, 7)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.subheadline)
                if let s = subtitle, !s.isEmpty { Text(s).font(.caption).foregroundStyle(Palette.muted) }
            }
        }
    }
}

private struct BusStep: View {
    let tl: TimedLeg
    let now: Date
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            RouteBadge(name: tl.leg.routeName)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    Text("\(untilText(now, tl.board)) · \(Tyumen.hm(tl.board))")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Palette.primary)
                    Badge(text: tl.live ? "онлайн" : tl.saved ? "по сохр. графику" : "по графику",
                          fill: tl.live ? Palette.secondaryContainer : Palette.cardHigh,
                          fg: tl.live ? Palette.onSecondaryContainer : Palette.muted)
                }
                let ride = max(1, Int(tl.alight.timeIntervalSince(tl.board) / 60))
                Text("Проезд ~\(ride) мин, \(tl.leg.stopsCount) ост. до «\(tl.leg.to.name)»")
                    .font(.caption).foregroundStyle(Palette.muted)
            }
        }
    }
}

private struct StopBoardCard: View {
    let b: StopBoard
    let now: Date
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(b.stop.name).font(.headline)
                    if !b.stop.desc.isEmpty { Text(b.stop.desc).font(.caption).foregroundStyle(Palette.muted) }
                }
                Spacer()
                Text("\(mins(b.walk.minutes)) мин пешком").font(.caption).foregroundStyle(Palette.muted)
            }
            if b.arrivals.isEmpty {
                Text("Нет онлайн-данных по этой остановке").font(.caption).foregroundStyle(Palette.muted)
            }
            ForEach(b.arrivals) { r in
                HStack(spacing: 8) {
                    RouteBadge(name: r.routeName, highlighted: r.useful).frame(width: 56, alignment: .leading)
                    Text(r.times.map { shortUntil(now, $0) }.joined(separator: " · "))
                        .font(.subheadline.weight(r.useful ? .semibold : .regular))
                }
            }
            if b.arrivals.contains(where: { $0.useful }) {
                Text("Выделены номера, которые идут в нужную сторону").font(.caption2).foregroundStyle(Palette.muted)
            }
        }
        .card()
    }
}
