import XCTest
@testable import TkpstCore

final class TimelineTests: XCTestCase {

    private func lesson(_ order: Int, _ s: String, _ e: String, _ title: String? = nil, replace: ApiReplace? = nil) -> ApiLesson {
        ApiLesson(title: title ?? "Предмет \(order)", cabinet: "101", teacher: "Иванов И.И.", order: order,
                  startTime: s + ":00", endTime: e + ":00", replace: replace)
    }

    private func m(_ s: String) -> Int { Bells.m(s) }

    /// Реальный ответ API за понедельник 28.09.2026 (ИС-25-3С).
    func testMondayClassHourIsNotAPair() {
        let lessons = [
            ApiLesson(title: "Классный час \"Разговоры о важном\"", cabinet: "302-1", teacher: "", order: 1, startTime: "08:00:00", endTime: "08:30:00"),
            ApiLesson(title: "ОГСЭ.04 Иностранный язык - 1 п/г", cabinet: "302-1", teacher: "Зыкова Е.И.", order: 2, startTime: "08:30:00", endTime: "10:00:00"),
            ApiLesson(title: "ОГСЭ.02 История", cabinet: "306", teacher: "Ильина  Т.В.", order: 3, startTime: "10:10:00", endTime: "11:40:00"),
            ApiLesson(title: "ОГСЭ.04 Иностранный язык - 2 п/г", cabinet: "310", teacher: "Моргунова  А.Ю.", order: 4, startTime: "12:20:00", endTime: "13:50:00"),
        ]
        let e = Timeline.build(weekday: 1, lessons: lessons)
        guard case .classHour = e[0] else { return XCTFail("первым должен быть классный час") }
        XCTAssertEqual(e[0].start, m("08:00"))

        var numbers: [Int] = []
        var teacher2 = ""
        for x in e { if case let .pair(n, _, _, ls, _) = x { numbers.append(n); if n == 2 { teacher2 = ls[0].teacher } } }
        XCTAssertEqual(numbers, [1, 2, 3])
        XCTAssertEqual(teacher2, "Ильина Т.В.")

        var breaks: [(Int, BreakKind)] = []
        for x in e { if case let .pause(s, en, k) = x { breaks.append((en - s, k)) } }
        XCTAssertEqual(breaks.map { $0.0 }, [10, 40])
        XCTAssertEqual(breaks[1].1, .big)
    }

    func testMondayAfternoonClassHour() {
        let e = Timeline.build(weekday: 1, lessons: [lesson(4, "14:35", "16:05"), lesson(5, "16:15", "17:45")])
        let chs = e.filter { if case .classHour = $0 { return true }; return false }
        XCTAssertEqual(chs.map { $0.start }, [m("14:00")])
        if case let .pause(s, en, _) = e[1] { XCTAssertEqual(en - s, 5) } else { XCTFail() }
    }

    func testTuesdayWindowAndBigBreak() {
        let e = Timeline.build(weekday: 2, lessons: [
            lesson(1, "08:15", "09:45"), lesson(2, "09:55", "11:25"),
            lesson(4, "13:45", "15:15"), lesson(5, "15:40", "17:10"),
        ])
        let kinds: [BreakKind] = e.compactMap { if case let .pause(_, _, k) = $0 { return k }; return nil }
        XCTAssertEqual(kinds, [.short, .window, .big])
    }

    func testTimesFromBells() {
        let e = Timeline.build(weekday: 3, lessons: [ApiLesson(title: "X", order: 3, startTime: "12:00:00", endTime: "13:30:00")])
        XCTAssertEqual(e.count, 1)
        XCTAssertEqual(e[0].start, m("12:05"))
        XCTAssertEqual(e[0].end, m("13:35"))
    }

    func testSundayEmpty() {
        XCTAssertTrue(Timeline.build(weekday: 7, lessons: [lesson(1, "08:15", "09:45")]).isEmpty)
    }

    func testReplacement() {
        let l = lesson(1, "08:15", "09:45", "Старый", replace: ApiReplace(title: "Новый", cabinet: nil, teacher: "Петров"))
        guard case let .pair(_, _, _, ls, _) = Timeline.build(weekday: 2, lessons: [l])[0] else { return XCTFail() }
        XCTAssertTrue(ls[0].replaced)
        XCTAssertEqual(ls[0].title, "Новый")
        XCTAssertEqual(ls[0].oldTitle, "Старый")
        XCTAssertEqual(ls[0].cabinet, "101")
        XCTAssertNil(ls[0].oldCabinet)
    }

    func testFormatLeft() {
        XCTAssertEqual(Timeline.formatLeft(30), "меньше минуты")
        XCTAssertEqual(Timeline.formatLeft(61), "2 мин")
        XCTAssertEqual(Timeline.formatLeft(80 * 60), "1 ч 20 мин")
        XCTAssertEqual(Timeline.formatLeft(120 * 60), "2 ч")
    }

    func testParserHandlesNullAndArray() throws {
        XCTAssertEqual(try ScheduleParser.lessons(from: Data("null".utf8)).count, 0)
        let json = #"[{"groupId":196,"date":"2026-09-29T00:00:00Z","lessons":[{"title":"A","cabinet":"204","teacher":"T","order":1,"startTime":"08:15:00","endTime":"09:45:00"}]}]"#
        XCTAssertEqual(try ScheduleParser.lessons(from: Data(json.utf8)).first?.cabinet, "204")
        XCTAssertThrowsError(try ScheduleParser.lessons(from: Data(#"{"statusCode":400,"error":"invalid groupId"}"#.utf8)))
    }

    func testTyumenWeekday() {
        // 28.09.2026 — понедельник; 04.10.2026 — воскресенье
        let mon = Tyumen.parseDay("2026-09-28")!
        XCTAssertEqual(Tyumen.weekday(mon), 1)
        XCTAssertEqual(Tyumen.weekday(Tyumen.parseDay("2026-10-04")!), 7)
        XCTAssertEqual(Tyumen.isoDay(Tyumen.monday(of: Tyumen.parseDay("2026-10-04")!)), "2026-09-28")
    }

    func testAdminOverrides() {
        let wed = [lesson(2, "09:55", "11:25"), lesson(3, "12:05", "13:35"), lesson(4, "13:45", "15:15")]
        let ov = OverridesData(days: ["2026-09-30": OverrideDay(pairs: [
            OverridePair(number: 2, status: "remote"),
            OverridePair(number: 3, status: "cancelled"),
            OverridePair(number: 4, title: "Графический дизайн", cabinet: "501"),
            OverridePair(number: 5, title: "Новая пара"),
        ])])
        let e = Timeline.build(weekday: 3, lessons: wed, day: "2026-09-30", overrides: ov)
        var st: [Int: PairStatus] = [:], ls: [Int: [LessonInfo]] = [:]
        for x in e { if case let .pair(n, _, _, l, s) = x { st[n] = s; ls[n] = l } }
        XCTAssertEqual(st[2], .remote)
        XCTAssertEqual(st[3], .cancelled)
        XCTAssertEqual(ls[4]?.first?.title, "Графический дизайн")
        XCTAssertEqual(ls[4]?.first?.cabinet, "501")
        XCTAssertEqual(ls[5]?.first?.added, true)
        XCTAssertEqual(e.filter { $0.isInPerson }.count, 2)
        XCTAssertTrue(Timeline.build(weekday: 3, lessons: wed, day: "2026-10-07", overrides: ov).allSatisfy { $0.isInPerson || { if case .pause = $0 { return true }; return false }($0) })
        let own = OverridesData(days: ["2026-10-01": OverrideDay(replaceAll: true, pairs: [OverridePair(number: 1, title: "Своя")])])
        XCTAssertEqual(Timeline.build(weekday: 4, lessons: [], day: "2026-10-01", overrides: own).count, 1)
        XCTAssertEqual(Timeline.build(weekday: 4, lessons: wed, day: "2026-10-01", overrides: own).count, 1)
        let json = #"{"announcement":"Привет","days":{"2026-09-30":{"note":"n","pairs":[{"number":2,"status":"remote"}]}}}"#
        let d = try! JSONDecoder().decode(OverridesData.self, from: Data(json.utf8))
        XCTAssertEqual(d.day("2026-09-30")?.pairs.first?.status, "remote")
        XCTAssertEqual(d.changedDays(comparedTo: OverridesData()), ["2026-09-30"])
    }

    private let monLessons = [
        ApiLesson(title: "Классный час \"Разговоры о важном\"", cabinet: "302-1", teacher: "", order: 1, startTime: "08:00:00", endTime: "08:30:00"),
        ApiLesson(title: "История", cabinet: "306", teacher: "", order: 2, startTime: "08:30:00", endTime: "10:00:00"),
        ApiLesson(title: "Физра", cabinet: "306", teacher: "", order: 3, startTime: "10:10:00", endTime: "11:40:00"),
    ]

    func testAdminBellsChangeTimesAndBreaks() {
        let week = [("08:00", "09:30"), ("09:45", "11:15"), ("12:00", "13:30"), ("13:40", "15:10"), ("15:20", "16:50"), ("17:00", "18:30")]
            .enumerated().map { BellTime($0.offset + 1, $0.element.0, $0.element.1) }
        let o = OverridesData(bells: BellsData(week: week, flag: BellRange("07:50", "08:20")))
        let e = Timeline.build(weekday: 2, lessons: [lesson(1, "08:15", "09:45"), lesson(2, "09:55", "11:25")], day: "2026-09-29", overrides: o)
        var starts: [Int] = []
        for x in e { if case let .pair(_, s, _, _, _) = x { starts.append(s) } }
        XCTAssertEqual(starts, [m("08:00"), m("09:45")])
        if case let .pause(s, en, _) = e[1] { XCTAssertEqual(en - s, 15) } else { XCTFail() }
        let mon = Timeline.build(weekday: 1, lessons: monLessons, day: "2026-09-28", overrides: o)
        XCTAssertEqual(mon[0].start, m("07:50"))
        XCTAssertEqual(mon[1].start, m("08:20"))
    }

    func testAdminDayTimesAndToggles() {
        let o = OverridesData(days: [
            "2026-09-28": OverrideDay(flag: false, classHour: true),
            "2026-09-30": OverrideDay(times: [BellTime(2, "10:30", "11:30"), BellTime(3, "25:00", "13:00")]),
            "2026-10-03": OverrideDay(flag: true),
        ])
        let mon = Timeline.build(weekday: 1, lessons: monLessons, day: "2026-09-28", overrides: o)
        let chs = mon.filter { if case .classHour = $0 { return true }; return false }
        XCTAssertEqual(chs.map { $0.start }, [m("14:00")])
        guard case .pair = mon[0] else { return XCTFail("флаг убран — первой идёт пара") }
        let wed = Timeline.build(weekday: 3, lessons: [lesson(2, "09:55", "11:25"), lesson(3, "12:05", "13:35")], day: "2026-09-30", overrides: o)
        var starts: [Int] = []
        for x in wed { if case let .pair(_, s, _, _, _) = x { starts.append(s) } }
        XCTAssertEqual(starts, [m("10:30"), m("12:05")])
        let sat = Timeline.build(weekday: 6, lessons: [], day: "2026-10-03", overrides: o)
        XCTAssertEqual(sat.map { $0.start }, [m("08:00")])
        XCTAssertNil(Bells.parseHm("8:5"))
        XCTAssertEqual(Bells.parseHm("8:05"), m("08:05"))
    }

    func testDecodeBellsFromJson() throws {
        let json = #"{"bells":{"sat":[{"number":1,"start":"09:00","end":"10:00"}],"classHour":{"start":"13:00","end":"13:30"}},"days":{"2026-10-03":{"pairs":[],"classHour":true}}}"#
        let o = try JSONDecoder().decode(OverridesData.self, from: Data(json.utf8))
        XCTAssertEqual(Bells.pairs(weekday: 6, day: nil, overrides: o).first?.start, m("09:00"))
        XCTAssertEqual(o.day("2026-10-03")?.classHour, true)
        XCTAssertEqual(Bells.classHour(o).start, m("13:00"))
    }
}
