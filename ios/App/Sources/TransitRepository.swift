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

    // ---------------- Онлайн-прогнозы ----------------

    private static func toDate(_ t: String, now: Date) -> Date? {
        let p = t.split(separator: ":").compactMap { Int($0) }
        guard p.count >= 2 else { return nil }
        var d = Tyumen.startOfDay(now).addingTimeInterval(TimeInterval(p[0] * 3600 + p[1] * 60 + (p.count > 2 ? p[2] : 0)))
        // Прогноз на «00:10», когда сейчас 23:50, — это уже завтра.
        if d < now.addingTimeInterval(-3 * 3600) { d = Tyumen.addDays(1, to: d) }
        return d
    }

    /// Все ближайшие автобусы на остановке по данным GPS. Кэш 20 секунд.
    func live(_ stopId: Int) async -> [LiveArrival] {
        if let c = predictions[stopId], Date().timeIntervalSince(c.at) < 20 { return c.items }
        let now = Date()
        var items: [LiveArrival] = predictions[stopId]?.items ?? []
        if let data = try? await Http.get("\(Self.base)/prediction/?checkpoint_id=\(stopId)"),
           let list = try? JSONDecoder().decode(TgtList<TgtPrediction>.self, from: data).objects {
            items = list.flatMap { p in
                (p.order ?? []).compactMap { o -> LiveArrival? in
                    guard let t = o.prediction?.time, let d = Self.toDate(t, now: now) else { return nil }
                    return LiveArrival(routeId: p.route_id, time: d, precise: o.prediction?.precise ?? true)
                }
            }
            .filter { $0.time >= now.addingTimeInterval(-60) }
            .sorted { $0.time < $1.time }
        }
        predictions[stopId] = (Date(), items)
        return items
    }

    func invalidateLive() { predictions.removeAll() }

    // ---------------- Расписание по графику ----------------

    func planned(stopId: Int, routeId: Int, forward: Bool, day: Date) async -> [Date] {
        let key = "\(stopId)/\(routeId)/\(forward)/\(Tyumen.isoDay(day))"
        if let p = planned[key] { return p }
        let url = "\(Self.base)/times/?checkpoint_id=\(stopId)&route_id=\(routeId)&date=\(Self.ymd(day))"
        guard let data = try? await Http.get(url),
              let objs = try? JSONDecoder().decode(TgtList<TgtTimes>.self, from: data).objects else { return [] }
        let matching = objs.filter { ($0.is_forward ?? true) == forward }
        let base = Tyumen.startOfDay(day)
        let list = (matching.isEmpty ? objs : matching).flatMap { $0.times ?? [] }.compactMap { s -> Date? in
            let p = s.split(separator: ":").compactMap { Int($0) }
            guard p.count >= 2 else { return nil }
            return base.addingTimeInterval(TimeInterval(p[0] * 3600 + p[1] * 60))
        }.sorted()
        planned[key] = list
        return list
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
        if let t = pick(await repo.planned(stopId: stopId, routeId: routeId, forward: forward, day: after)) {
            return Departure(time: t, live: false)
        }
        if let t = pick(await repo.planned(stopId: stopId, routeId: routeId, forward: forward, day: Tyumen.addDays(1, to: after))) {
            return Departure(time: t, live: false)
        }
        return nil
    }
}
