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
        for x in e { if case let .pair(n, _, _, ls) = x { numbers.append(n); if n == 2 { teacher2 = ls[0].teacher } } }
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
        guard case let .pair(_, _, _, ls) = Timeline.build(weekday: 2, lessons: [l])[0] else { return XCTFail() }
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
}
