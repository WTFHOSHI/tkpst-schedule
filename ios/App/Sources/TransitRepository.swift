import Foundation
import TkpstCore

struct LiveArrival: Sendable {
    let routeId: Int
    let time: Date
    let precise: Bool
}

/// Данные Тюменьгортранса: сеть маршрутов (кэш на день), онлайн-прогнозы, расписание по графику.
actor TransitRepository {
    static let shared = TransitRepository()
    static let base = "https://api.tgt72.ru/api/v5"

    private var network: Network?
    private var predictions: [Int: (at: Date, items: [LiveArrival])] = [:]
    private var planned: [String: [Date]] = [:]
    private var loading: Task<Network, Error>?

    /// Сервер Тюменьгортранса не ответил при последнем обновлении.
    private(set) var hadNetworkErrors = false
    /// Время бралось из сохранённого на телефоне графика.
    private(set) var usedSavedTimetable = false
    func resetErrors() { hadNetworkErrors = false; usedSavedTimetable = false }

    private var fileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("network.json")
    }

    private static func ymd(_ d: Date) -> String { Tyumen.isoDay(d).replacingOccurrences(of: "-", with: "") }

    // ---------------- Сеть маршрутов ----------------

    /// Сеть на сегодня: из памяти, из файла или скачивается (~130 запросов, раз в день).
    func network(progress: @escaping @Sendable (Int, Int) -> Void) async throws -> Network {
        let today = Tyumen.isoDay(Date())
        if let n = network, n.data.date == today { return n }
        let fromFile = (try? Data(contentsOf: fileURL)).flatMap { try? JSONDecoder().decode(NetworkData.self, from: $0) }
        if let f = fromFile, f.date == today {
            let n = Network(f); network = n; return n
        }
        if let loading { return try await loading.value }
        let task = Task { () throws -> Network in
            let data = try await Self.download(progress: progress)
            // Перезаписываем один и тот же файл — размер не растёт.
            if let enc = try? JSONEncoder().encode(data) { try? enc.write(to: self.fileURL, options: .atomic) }
            return Network(data)
        }
        loading = task
        defer { loading = nil }
        do {
            let n = try await task.value
            network = n
            return n
        } catch {
            // Нет сети — работаем на вчерашних данных, если есть.
            if let f = fromFile { let n = Network(f); network = n; return n }
            throw error
        }
    }

    private static func download(progress: @escaping @Sendable (Int, Int) -> Void) async throws -> NetworkData {
        let today = Date()
        let todayStr = Tyumen.isoDay(today)
        let dec = JSONDecoder()
        let routes = try dec.decode(TgtList<TgtRoute>.self, from: try await Http.get("\(base)/routesforsearch/", timeout: 30)).objects
            .filter { !($0.outdated ?? false) && (($0.dates ?? []).isEmpty || ($0.dates ?? []).contains(todayStr)) }
        let checkpoints = try dec.decode(TgtList<TgtCheckpoint>.self, from: try await Http.get("\(base)/checkpointsforsearch/", timeout: 60)).objects
            .filter { ($0.coordinate?.count ?? 0) >= 2 }
        var byId: [Int: TgtCheckpoint] = [:]
        for c in checkpoints { byId[c.id] = c }
        let known = Set(byId.keys)

        progress(0, routes.count)
        var patterns: [Pattern] = []
        var done = 0
        // Не больше 8 запросов одновременно.
        try await withThrowingTaskGroup(of: [Pattern].self) { group in
            var next = 0
            while next < min(8, routes.count) {
                let r = routes[next]; next += 1
                group.addTask { await Self.patterns(for: r, day: today, known: known) }
            }
            while let res = try await group.next() {
                patterns += res
                done += 1
                progress(done, routes.count)
                if next < routes.count {
                    let r = routes[next]; next += 1
                    group.addTask { await Self.patterns(for: r, day: today, known: known) }
                }
            }
        }
        if patterns.isEmpty { throw HttpError(message: "Сервер не вернул маршруты") }
        let used = Set(patterns.flatMap { $0.stops })
        let stops: [Stop] = used.compactMap { id in
            guard let c = byId[id], let coord = c.coordinate else { return nil }
            return Stop(id: id, name: (c.name ?? "").trimmingCharacters(in: .whitespaces),
                        desc: (c.description ?? "").trimmingCharacters(in: .whitespaces),
                        lat: coord[1], lon: coord[0])
        }
        return NetworkData(date: todayStr, stops: stops, patterns: patterns)
    }

    /// Направления одного маршрута (порядок остановок туда и обратно).
    private static func patterns(for r: TgtRoute, day: Date, known: Set<Int>) async -> [Pattern] {
        let url = "\(base)/routecheckpoint/?route_id=\(r.id)&date=\(ymd(day))"
        guard let data = try? await Http.get(url),
              let list = try? JSONDecoder().decode(TgtList<TgtRouteCheckpoint>.self, from: data).objects
        else { return [] }
        var out: [Pattern] = []
        for fwd in [true, false] {
            var items = list.filter { ($0.forward ?? true) == fwd }
            let primary = items.filter { $0.primary ?? true }
            if !primary.isEmpty { items = primary }
            var ordered: [Int] = []
            for x in items.sorted(by: { ($0.order ?? 0) < ($1.order ?? 0) }) where known.contains(x.checkpoint_id) {
                if ordered.last != x.checkpoint_id { ordered.append(x.checkpoint_id) }
            }
            if ordered.count >= 2 {
                out.append(Pattern(routeId: r.id, routeName: r.name ?? "?", forward: fwd, stops: ordered))
            }
        }
        return out
    }

    // ---------------- Ограничение запросов ----------------
    // Не больше 6 запросов к Тюменьгортрансу одновременно, одинаковые не дублируются —
    // иначе сервер начинает тормозить и отбивать запросы.

    private let limiter = AsyncLimiter(6)

    private func limitedGet(_ url: String) async throws -> Data {
        await limiter.acquire()
        do {
            let d = try await Http.get(url, timeout: 10)
            await limiter.release()
            return d
        } catch {
            await limiter.release()
            throw error
        }
    }

    // ---------------- Онлайн-прогнозы ----------------

    private static func toDate(_ t: String, now: Date) -> Date? {
        let p = t.split(separator: ":").compactMap { Int($0) }
        guard p.count >= 2 else { return nil }
        var d = Tyumen.startOfDay(now).addingTimeInterval(TimeInterval(p[0] * 3600 + p[1] * 60 + (p.count > 2 ? p[2] : 0)))
        // Прогноз на «00:10», когда сейчас 23:50, — это уже завтра.
        if d < now.addingTimeInterval(-3 * 3600) { d = Tyumen.addDays(1, to: d) }
        return d
    }

    private var liveInFlight: [Int: Task<[LiveArrival]?, Never>] = [:]

    /// Все ближайшие автобусы на остановке по данным GPS. Кэш 20 секунд.
    func live(_ stopId: Int) async -> [LiveArrival] {
        if let c = predictions[stopId], Date().timeIntervalSince(c.at) < 20 { return c.items }
        let task: Task<[LiveArrival]?, Never>
        if let t = liveInFlight[stopId] {
            task = t
        } else {
            task = Task {
                let now = Date()
                guard let data = try? await self.limitedGet("\(Self.base)/prediction/?checkpoint_id=\(stopId)"),
                      let list = try? JSONDecoder().decode(TgtList<TgtPrediction>.self, from: data).objects else { return nil }
                return list.flatMap { p in
                    (p.order ?? []).compactMap { o -> LiveArrival? in
                        guard let t = o.prediction?.time, let d = Self.toDate(t, now: now) else { return nil }
                        return LiveArrival(routeId: p.route_id, time: d, precise: o.prediction?.precise ?? true)
                    }
                }
                .filter { $0.time >= now.addingTimeInterval(-60) }
                .sorted { $0.time < $1.time }
            }
            liveInFlight[stopId] = task
        }
        let fresh = await task.value
        liveInFlight[stopId] = nil
        if fresh == nil { hadNetworkErrors = true }
        let items = fresh ?? predictions[stopId]?.items ?? []
        predictions[stopId] = (Date(), items)
        return items
    }

    func invalidateLive() { predictions.removeAll() }

    // ---------------- Архив графика на телефоне ----------------
    // Каждый удачный ответ сохраняется по типу дня (будни / суббота / воскресенье).
    // Если сервер Тюменьгортранса не отвечает, маршруты строятся по этому архиву.

    private struct SavedStopDay: Codable { let date: String; let items: [TgtTimes] }

    private var ttDir: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("timetables", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private static func dayType(_ day: Date) -> String {
        switch Tyumen.weekday(day) { case 6: return "sat"; case 7: return "sun"; default: return "wd" }
    }

    private func savedURL(_ stopId: Int, _ type: String) -> URL { ttDir.appendingPathComponent("\(stopId)_\(type).json") }

    private func saveStopDay(_ stopId: Int, _ day: Date, _ items: [TgtTimes]) {
        if let d = try? JSONEncoder().encode(SavedStopDay(date: Tyumen.isoDay(day), items: items)) {
            try? d.write(to: savedURL(stopId, Self.dayType(day)), options: .atomic)
        }
    }

    private func loadSavedStopDay(_ stopId: Int, _ day: Date) -> [TgtTimes]? {
        // Нет графика этого типа дня — берём любой сохранённый (лучше, чем ничего).
        let types = [Self.dayType(day)] + ["wd", "sat", "sun"]
        for t in types {
            if let d = try? Data(contentsOf: savedURL(stopId, t)),
               let s = try? JSONDecoder().decode(SavedStopDay.self, from: d) { return s.items }
        }
        return nil
    }

    private func savedToday(_ stopId: Int, _ day: Date) -> Bool {
        let url = savedURL(stopId, Self.dayType(day))
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let m = attrs[.modificationDate] as? Date else { return false }
        return Tyumen.isoDay(m) == Tyumen.isoDay(Date())
    }

    // ---------------- Расписание по графику ----------------

    /// График остановки на день — одним запросом сразу для всех номеров.
    private struct StopDay { let at: Date; let byRoute: [Int: [TgtTimes]]?; let saved: Bool }
    private var stopDays: [String: StopDay] = [:]
    private var stopDayInFlight: [String: Task<StopDay, Never>] = [:]
    private var savedKeys = Set<String>()
    private var routeFallbackFailedAt: [String: Date] = [:]

    func isSaved(_ stopId: Int, _ day: Date) -> Bool { savedKeys.contains("\(stopId)/\(Tyumen.isoDay(day))") }

    private func stopDay(_ stopId: Int, _ day: Date) async -> [Int: [TgtTimes]]? {
        let key = "\(stopId)/\(Tyumen.isoDay(day))"
        // Неудачи и данные из архива перепроверяем не чаще раза в минуту.
        if let c = stopDays[key], (c.byRoute != nil && !c.saved) || Date().timeIntervalSince(c.at) < 60 {
            return note(c, key)
        }
        let task: Task<StopDay, Never>
        if let t = stopDayInFlight[key] {
            task = t
        } else {
            task = Task {
                let url = "\(Self.base)/times/?checkpoint_id=\(stopId)&date=\(Self.ymd(day))"
                if let data = try? await self.limitedGet(url),
                   let items = try? JSONDecoder().decode(TgtList<TgtTimes>.self, from: data).objects {
                    if !items.isEmpty { self.saveStopDay(stopId, day, items) }
                    return StopDay(at: Date(), byRoute: Dictionary(grouping: items) { $0.route_id ?? -1 }, saved: false)
                }
                let saved = self.loadSavedStopDay(stopId, day)
                return StopDay(at: Date(), byRoute: saved.map { Dictionary(grouping: $0) { $0.route_id ?? -1 } }, saved: saved != nil)
            }
            stopDayInFlight[key] = task
        }
        let v = await task.value
        stopDayInFlight[key] = nil
        stopDays[key] = v
        return note(v, key)
    }

    private func note(_ v: StopDay, _ key: String) -> [Int: [TgtTimes]]? {
        if v.byRoute == nil || v.saved { hadNetworkErrors = true }
        if v.saved { usedSavedTimetable = true; savedKeys.insert(key) } else { savedKeys.remove(key) }
        return v.byRoute
    }

    /// Докачать и сохранить график остановок (для работы без сервера). Уже сохранённые сегодня пропускаются.
    func prefetchTimetables(_ stopIds: [Int], day: Date) async {
        let todo = Array(Set(stopIds)).filter { !savedToday($0, day) }
        var i = 0
        while i < todo.count {
            // по 2 запроса одновременно
            let batch = todo[i..<min(i + 2, todo.count)]
            await withTaskGroup(of: Void.self) { g in
                for id in batch { g.addTask { _ = await self.stopDay(id, day) } }
            }
            i += 2
        }
    }

    private func parseTimes(_ objs: [TgtTimes], forward: Bool, day: Date) -> [Date] {
        let matching = objs.filter { ($0.is_forward ?? true) == forward }
        let base = Tyumen.startOfDay(day)
        return (matching.isEmpty ? objs : matching).flatMap { $0.times ?? [] }.compactMap { s -> Date? in
            let p = s.split(separator: ":").compactMap { Int($0) }
            guard p.count >= 2 else { return nil }
            return base.addingTimeInterval(TimeInterval(p[0] * 3600 + p[1] * 60))
        }.sorted()
    }

    /// Время по графику для маршрута на остановке (кэш на день).
    func planned(stopId: Int, routeId: Int, forward: Bool, day: Date) async -> [Date] {
        let key = "\(stopId)/\(routeId)/\(forward)/\(Tyumen.isoDay(day))"
        if let p = planned[key] { return p }
        guard let byRoute = await stopDay(stopId, day) else { hadNetworkErrors = true; return [] }
        var objs = byRoute[routeId] ?? []
        if objs.isEmpty {
            // В общем графике остановки этого номера нет — запасной запрос именно по маршруту.
            if routeFallbackFailedAt[key].map({ Date().timeIntervalSince($0) > 60 }) ?? true {
                let url = "\(Self.base)/times/?checkpoint_id=\(stopId)&route_id=\(routeId)&date=\(Self.ymd(day))"
                if let data = try? await limitedGet(url),
                   let o = try? JSONDecoder().decode(TgtList<TgtTimes>.self, from: data).objects {
                    objs = o
                } else {
                    routeFallbackFailedAt[key] = Date()
                    hadNetworkErrors = true
                }
            }
        }
        let list = parseTimes(objs, forward: forward, day: day)
        if !isSaved(stopId, day) { planned[key] = list }
        return list
    }
}

/// Не больше N одновременных задач.
actor AsyncLimiter {
    private var free: Int
    private var waiters: [CheckedContinuation<Void, Never>] = []
    init(_ n: Int) { free = n }
    func acquire() async {
        if free > 0 { free -= 1; return }
        await withCheckedContinuation { waiters.append($0) }
    }
    func release() {
        if waiters.isEmpty { free += 1 } else { waiters.removeFirst().resume() }
    }
}

/// Сначала онлайн-прогноз; если его нет или он не достаёт до нужного времени — по графику.
struct LiveDepartureSource: DepartureSource {
    func next(stopId: Int, routeId: Int, forward: Bool, after: Date) async -> Departure? {
        let repo = TransitRepository.shared
        let liveTimes = await repo.live(stopId).filter { $0.routeId == routeId }
        if let l = liveTimes.first(where: { $0.time >= after }) { return Departure(time: l.time, live: true) }
        let lastLive = liveTimes.last?.time
        func pick(_ list: [Date]) -> Date? {
            list.first { $0 >= after && (lastLive == nil || $0 > lastLive!.addingTimeInterval(120)) }
        }
        for add in 0...1 {
            let day = Tyumen.addDays(add, to: after)
            if let t = pick(await repo.planned(stopId: stopId, routeId: routeId, forward: forward, day: day)) {
                return Departure(time: t, live: false, saved: await repo.isSaved(stopId, day))
            }
        }
        return nil
    }
}
