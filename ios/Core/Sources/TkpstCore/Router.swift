import Foundation

/// Сеть маршрутов с предрасчётами для быстрого поиска.
public final class Network: @unchecked Sendable {
    public let data: NetworkData
    public let stops: [Int: Stop]
    public let patterns: [Pattern]
    /// Накопленное время поездки (мин) от начала направления до каждой остановки.
    public let cum: [[Double]]
    /// Остановка → список (индекс направления, позиция).
    public let byStop: [Int: [(Int, Int)]]
    private var neighborCache: [Int: [(Stop, Double)]] = [:]
    private let lock = NSLock()

    static let busMPerMin = 350.0
    static let rideDetour = 1.15
    static let dwellMin = 0.5

    public init(_ data: NetworkData) {
        self.data = data
        var s: [Int: Stop] = [:]
        for st in data.stops { s[st.id] = st }
        stops = s
        patterns = data.patterns.filter { p in p.stops.count >= 2 && p.stops.allSatisfy { s[$0] != nil } }
        cum = patterns.map { p in
            var arr = [Double](repeating: 0, count: p.stops.count)
            for i in 1..<p.stops.count {
                let d = Geo.distanceM(s[p.stops[i - 1]]!, s[p.stops[i]]!)
                arr[i] = arr[i - 1] + d * Network.rideDetour / Network.busMPerMin + Network.dwellMin
            }
            return arr
        }
        var idx: [Int: [(Int, Int)]] = [:]
        for (pi, p) in patterns.enumerated() {
            for (pos, sid) in p.stops.enumerated() { idx[sid, default: []].append((pi, pos)) }
        }
        byStop = idx
    }

    public func near(_ p: LatLng, radius: Double) -> [(Stop, Double)] {
        stops.values
            .filter { byStop[$0.id] != nil }
            .map { ($0, Geo.distanceM(p, $0)) }
            .filter { $0.1 <= radius }
            .sorted { $0.1 < $1.1 }
    }

    public func neighbors(_ stopId: Int, radius: Double) -> [(Stop, Double)] {
        lock.lock(); defer { lock.unlock() }
        if let c = neighborCache[stopId] { return c }
        let s = stops[stopId]!
        let list = stops.values
            .filter { byStop[$0.id] != nil }
            .map { ($0, Geo.distanceM(s, $0)) }
            .filter { $0.1 <= radius }
        neighborCache[stopId] = list
        return list
    }

    /// Номер маршрута по id.
    public var routeNames: [Int: String] {
        var m: [Int: String] = [:]
        for p in patterns { m[p.routeId] = p.routeName }
        return m
    }
}

public struct Walk: Equatable, Sendable {
    public let meters: Int
    public let minutes: Double
}

public struct RideLeg: Equatable, Sendable {
    public let routeId: Int
    public let routeName: String
    public let forward: Bool
    public let from: Stop
    public let to: Stop
    public let stopsCount: Int
    public let rideMin: Double
}

/// Вариант поездки без привязки ко времени.
public struct Plan: Sendable {
    public let walkStart: Walk
    public let legs: [RideLeg]
    public let transferWalk: Walk?
    public let walkEnd: Walk
    /// Оценка для первичной сортировки (без ожидания первого автобуса).
    public let staticMin: Double

    public var key: String { legs.map { "\($0.routeId)\($0.forward ? "f" : "b")" }.joined(separator: ">") }
}

public struct Departure: Sendable {
    public let time: Date
    public let live: Bool
    public init(time: Date, live: Bool) { self.time = time; self.live = live }
}

/// Источник времени прибытия автобусов на остановку.
public protocol DepartureSource: Sendable {
    /// Первый автобус маршрута на остановке не раньше `after`.
    func next(stopId: Int, routeId: Int, forward: Bool, after: Date) async -> Departure?
}

public struct TimedLeg: Sendable {
    public let leg: RideLeg
    public let board: Date
    public let live: Bool
    public let alight: Date
}

public struct Journey: Sendable, Identifiable {
    public let plan: Plan
    /// Когда выходить из дома / колледжа.
    public let leaveAt: Date
    public let legs: [TimedLeg]
    public let arrive: Date
    /// Другие номера, которые идут тем же путём («или №14, 54»).
    public var alternatives: [String] = []

    public var id: String { plan.key + "@\(legs.first!.board.timeIntervalSince1970)" }
    public var durationMin: Int { Int((arrive.timeIntervalSince(leaveAt) / 60).rounded(.down)) }

    var groupKey: String {
        if legs.count == 1 { return "D:\(legs[0].leg.from.id)>\(legs[0].leg.to.id)" }
        return "T:\(legs[0].leg.routeName):\(legs[0].leg.from.id)>\(legs[0].leg.to.id)>\(legs[1].leg.from.id)>\(legs[1].leg.to.id)"
    }
}

public enum RouteSort: Sendable { case duration, arrival }

public enum Router {
    public static let accessRadius = 1000.0
    public static let transferRadius = 500.0
    /// Условное ожидание на пересадке для первичной сортировки.
    public static let transferPenaltyMin = 6.0

    static func walk(_ straight: Double) -> Walk {
        Walk(meters: Int(Geo.walkM(straight)), minutes: Geo.walkMin(straight))
    }

    /// Прямые варианты и с одной пересадкой (пешком до 500 м).
    public static func findPlans(_ net: Network, from origin: LatLng, to dest: LatLng, limit: Int = 30) -> [Plan] {
        let nearO = net.near(origin, radius: accessRadius)
        let nearD = net.near(dest, radius: accessRadius)
        if nearO.isEmpty || nearD.isEmpty { return [] }
        var walkO: [Int: Double] = [:], distO: [Int: Double] = [:]
        for (s, d) in nearO { walkO[s.id] = Geo.walkMin(d); distO[s.id] = d }
        var walkD: [Int: Double] = [:], distD: [Int: Double] = [:]
        for (s, d) in nearD { walkD[s.id] = Geo.walkMin(d); distD[s.id] = d }

        // best[i] = min_{j>i}(cum[j] + walkD[j]), bestAt[i] = j
        var egBest: [[Double]] = []
        var egAt: [[Int]] = []
        egBest.reserveCapacity(net.patterns.count)
        for (pi, p) in net.patterns.enumerated() {
            let c = net.cum[pi]
            let n = p.stops.count
            var best = [Double](repeating: .infinity, count: n)
            var at = [Int](repeating: -1, count: n)
            var cb = Double.infinity, ca = -1
            for i in stride(from: n - 1, through: 0, by: -1) {
                best[i] = cb; at[i] = ca
                if let w = walkD[p.stops[i]], c[i] + w < cb { cb = c[i] + w; ca = i }
            }
            egBest.append(best); egAt.append(at)
        }

        func leg(_ pi: Int, _ from: Int, _ to: Int) -> RideLeg {
            let p = net.patterns[pi]
            return RideLeg(routeId: p.routeId, routeName: p.routeName, forward: p.forward,
                           from: net.stops[p.stops[from]]!, to: net.stops[p.stops[to]]!,
                           stopsCount: to - from, rideMin: net.cum[pi][to] - net.cum[pi][from])
        }

        var results: [String: Plan] = [:]
        func offer(_ plan: Plan) {
            if let old = results[plan.key], old.staticMin <= plan.staticMin { return }
            results[plan.key] = plan
        }

        // --- Прямые ---
        var bestDirect = Double.infinity
        for (b, _) in nearO {
            let wO = walkO[b.id]!
            for (pi, i) in net.byStop[b.id] ?? [] {
                if egBest[pi][i].isInfinite { continue }
                let j = egAt[pi][i]
                let total = wO + egBest[pi][i] - net.cum[pi][i]
                bestDirect = min(bestDirect, total)
                let aId = net.patterns[pi].stops[j]
                offer(Plan(walkStart: walk(distO[b.id]!), legs: [leg(pi, i, j)], transferWalk: nil,
                           walkEnd: walk(distD[aId]!), staticMin: total))
            }
        }

        // --- С одной пересадкой ---
        let bound = bestDirect.isFinite ? bestDirect + 20 : 150.0
        var transferBest: [Int64: Plan] = [:]
        func code(_ p: Pattern) -> Int64 { Int64(p.routeId) * 2 + (p.forward ? 1 : 0) }
        for (b, _) in nearO {
            let wO = walkO[b.id]!
            for (pi1, i) in net.byStop[b.id] ?? [] {
                let p1 = net.patterns[pi1]
                let c1 = net.cum[pi1]
                let code1 = code(p1) << 32
                if i + 1 >= p1.stops.count { continue }
                for k in (i + 1)..<p1.stops.count {
                    let t1 = wO + c1[k] - c1[i]
                    if t1 > bound { break }
                    let xId = p1.stops[k]
                    if walkD[xId] != nil { continue } // отсюда уже можно дойти пешком
                    for (y, dxy) in net.neighbors(xId, radius: transferRadius) {
                        let tw = Geo.walkMin(dxy)
                        for (pi2, m) in net.byStop[y.id] ?? [] {
                            let p2 = net.patterns[pi2]
                            if p2.routeId == p1.routeId { continue }
                            let e = egBest[pi2][m]
                            if e.isInfinite { continue }
                            let total = t1 + tw + transferPenaltyMin + e - net.cum[pi2][m]
                            if total > bound + transferPenaltyMin { continue }
                            let key = code1 | code(p2)
                            if let old = transferBest[key], old.staticMin <= total { continue }
                            let j = egAt[pi2][m]
                            transferBest[key] = Plan(
                                walkStart: walk(distO[b.id]!),
                                legs: [leg(pi1, i, k), leg(pi2, m, j)],
                                transferWalk: walk(dxy),
                                walkEnd: walk(distD[p2.stops[j]]!),
                                staticMin: total
                            )
                        }
                    }
                }
            }
        }
        transferBest.values.forEach(offer)

        return results.values
            .filter { $0.legs.count == 1 || $0.staticMin <= bound + transferPenaltyMin }
            .sorted { $0.staticMin < $1.staticMin }
            .prefix(limit)
            .map { $0 }
    }

    // ---------------- Привязка ко времени ----------------

    public static func schedule(_ plan: Plan, now: Date, source: DepartureSource) async -> Journey? {
        var t = now.addingTimeInterval(plan.walkStart.minutes * 60)
        var timed: [TimedLeg] = []
        for (idx, l) in plan.legs.enumerated() {
            if idx > 0 { t = t.addingTimeInterval((plan.transferWalk?.minutes ?? 0) * 60) }
            guard let dep = await source.next(stopId: l.from.id, routeId: l.routeId, forward: l.forward, after: t) else {
                return nil
            }
            let alight = dep.time.addingTimeInterval(l.rideMin * 60)
            timed.append(TimedLeg(leg: l, board: dep.time, live: dep.live, alight: alight))
            t = alight
        }
        let arrive = t.addingTimeInterval(plan.walkEnd.minutes * 60)
        // Выйти так, чтобы прийти на остановку за минуту до автобуса.
        let leave = timed[0].board.addingTimeInterval(-(plan.walkStart.minutes + 1) * 60)
        return Journey(plan: plan, leaveAt: max(leave, now), legs: timed, arrive: arrive)
    }

    static func ordered(_ list: [Journey], _ sort: RouteSort) -> [Journey] {
        switch sort {
        case .duration:
            return list.sorted { ($0.durationMin, $0.arrive) < ($1.durationMin, $1.arrive) }
        case .arrival:
            return list.sorted { ($0.arrive, $0.durationMin) < ($1.arrive, $1.durationMin) }
        }
    }

    /// Лучшие варианты: сначала самые короткие в пути (или раньше всех приезжающие).
    public static func rank(_ journeys: [Journey], sort: RouteSort, now: Date, take: Int = 5) -> [Journey] {
        // Не предлагаем автобусы, до которых больше часа.
        var soon = journeys.filter { $0.leaveAt.timeIntervalSince(now) <= 3600 }
        if soon.isEmpty { soon = journeys }
        let sorted = ordered(soon, sort)
        // Склеиваем одинаковые пути с разными номерами.
        var groups: [String: [Journey]] = [:]
        var order: [String] = []
        for j in sorted {
            if groups[j.groupKey] == nil { order.append(j.groupKey) }
            groups[j.groupKey, default: []].append(j)
        }
        var grouped: [Journey] = order.map { key in
            let g = groups[key]!
            var best = g[0]
            let bestName = best.legs.last!.leg.routeName
            var alts: [String] = []
            for other in g.dropFirst() {
                let n = other.legs.last!.leg.routeName
                if n != bestName && !alts.contains(n) { alts.append(n) }
            }
            best.alternatives = alts
            return best
        }
        grouped = ordered(grouped, sort)
        var seen = Set<String>()
        var out: [Journey] = []
        for j in grouped {
            let k = j.legs.map { $0.leg.routeName }.joined(separator: ">")
            if seen.insert(k).inserted { out.append(j) }
            if out.count >= max(1, take) { break }
        }
        return out
    }
}
