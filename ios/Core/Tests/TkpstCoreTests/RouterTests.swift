import XCTest
@testable import TkpstCore

final class RouterTests: XCTestCase {

    private func stop(_ id: Int, _ lon: Double, lat: Double = 57.15) -> Stop {
        Stop(id: id, name: "S\(id)", desc: "", lat: lat, lon: lon)
    }

    private let home = LatLng(lat: 57.15, lon: 65.40)
    private let college = LatLng(lat: 57.15, lon: 65.50)

    private lazy var net: Network = {
        var stops: [Stop] = [stop(1, 65.401)]
        for i in 2...10 { stops.append(stop(i, 65.40 + Double(i) * 0.01, lat: 57.18)) }
        stops.append(stop(11, 65.499))
        for i in 20...25 { stops.append(stop(i, 65.402 + Double(i - 20) * 0.01)) }
        for i in 30...35 { stops.append(stop(i, 65.452 + Double(i - 30) * 0.0095)) }
        return Network(NetworkData(date: "2026-09-29", stops: stops, patterns: [
            Pattern(routeId: 1, routeName: "A", forward: true, stops: Array(1...11)),
            Pattern(routeId: 1, routeName: "A", forward: false, stops: Array((1...11).reversed())),
            Pattern(routeId: 2, routeName: "B", forward: true, stops: Array(20...25)),
            Pattern(routeId: 3, routeName: "C", forward: true, stops: Array(30...35)),
            Pattern(routeId: 4, routeName: "D", forward: true, stops: Array(30...35)),
        ]))
    }()

    func testFindsDirectAndTransfer() {
        let plans = Router.findPlans(net, from: home, to: college)
        XCTAssertTrue(plans.contains { $0.legs.count == 1 && $0.legs[0].routeName == "A" && $0.legs[0].forward })
        XCTAssertTrue(plans.contains { $0.legs.count == 2 && $0.legs[0].routeName == "B" && $0.legs[1].routeName == "C" })
        XCTAssertFalse(plans.contains { $0.legs.contains { $0.routeName == "A" && !$0.forward } })
        let direct = plans.first { $0.legs.count == 1 }!
        let transfer = plans.first { $0.legs.count == 2 }!
        XCTAssertLessThan(transfer.staticMin, direct.staticMin)
    }

    struct FakeSource: DepartureSource {
        let now: Date
        func next(stopId: Int, routeId: Int, forward: Bool, after: Date) async -> Departure? {
            var t = now.addingTimeInterval(routeId == 3 ? 300 : 0)
            while t < after { t = t.addingTimeInterval(600) }
            return Departure(time: t, live: routeId != 2)
        }
    }

    func testSchedulingAndGrouping() async {
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        let plans = Router.findPlans(net, from: home, to: college)
        var journeys: [Journey] = []
        for p in plans { if let j = await Router.schedule(p, now: now, source: FakeSource(now: now)) { journeys.append(j) } }
        for j in journeys {
            XCTAssertGreaterThanOrEqual(j.leaveAt, now)
            for i in 1..<max(1, j.legs.count) { XCTAssertGreaterThanOrEqual(j.legs[i].board, j.legs[i - 1].alight) }
        }
        let ranked = Router.rank(journeys, sort: .duration, now: now)
        XCTAssertFalse(ranked.isEmpty)
        XCTAssertEqual(ranked.map { $0.durationMin }, ranked.map { $0.durationMin }.sorted())
        let t = ranked.first { $0.legs.count == 2 }!
        XCTAssertFalse(t.alternatives.isEmpty)
    }

    func testNoStopsNearby() {
        XCTAssertTrue(Router.findPlans(net, from: LatLng(lat: 56, lon: 60), to: college).isEmpty)
    }

    func testArriveByLatestDeparture() async {
        let day = Date(timeIntervalSince1970: 1_790_000_000)
        let now = day.addingTimeInterval(-12 * 3600)
        // Автобусы каждые 10 минут, начиная с `day`
        struct Every10: DepartureSource {
            let start: Date
            func next(stopId: Int, routeId: Int, forward: Bool, after: Date) async -> Departure? {
                var t = start.addingTimeInterval(routeId == 3 ? 300 : 0)
                while t < after { t = t.addingTimeInterval(600) }
                return Departure(time: t, live: false, saved: true)
            }
        }
        let src = Every10(start: day)
        let deadline = day.addingTimeInterval(2 * 3600)
        var js: [Journey] = []
        for p in Router.findPlans(net, from: home, to: college) {
            if let j = await Router.arriveBy(p, deadline: deadline, earliest: now, source: src) { js.append(j) }
        }
        XCTAssertFalse(js.isEmpty)
        for j in js {
            XCTAssertLessThanOrEqual(j.arrive, deadline, "успеваем")
            XCTAssertGreaterThan(j.arrive, deadline.addingTimeInterval(-11 * 60), "не выезжаем слишком рано")
            XCTAssertTrue(j.legs.allSatisfy { $0.saved })
        }
        let r = Router.rank(js, sort: .latest, now: now)
        XCTAssertEqual(r.map { $0.leaveAt }, r.map { $0.leaveAt }.sorted(by: >))
        // Слишком близкий срок — не успеть
        let plan = Router.findPlans(net, from: home, to: college)[0]
        let tooSoon = await Router.arriveBy(plan, deadline: day.addingTimeInterval(300), earliest: day, source: src)
        XCTAssertNil(tooSoon)
    }
}
