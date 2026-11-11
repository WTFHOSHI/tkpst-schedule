import XCTest
@testable import TkpstCore

final class DayStateTests: XCTestCase {
    private func m(_ s: String) -> Int { Bells.m(s) }
    private func pair(_ n: Int, _ a: String, _ b: String, _ status: PairStatus = .normal) -> Entry {
        .pair(number: n, start: m(a), end: m(b), lessons: [LessonInfo(title: "Предмет \(n)", cabinet: "10\(n)", teacher: "")], status: status)
    }
    private func pause(_ a: String, _ b: String) -> Entry { .pause(start: m(a), end: m(b), kind: .short) }
    private var day: [Entry] { [pair(1, "08:30", "10:00"), pause("10:00", "10:10"), pair(2, "10:10", "11:40")] }
    private func at(_ time: String, _ days: [Int: [Entry]]) -> NowState {
        DayState.at(minute: m(time)) { days[$0] ?? [] }
    }

    func testBeforeFirstPairShowsItAsUpcoming() {
        XCTAssertEqual(at("07:00", [0: day]), .upcoming(entry: pair(1, "08:30", "10:00"), dayOffset: 0))
    }

    func testSwitchesBetweenPairAndBreak() {
        XCTAssertEqual(at("09:15", [0: day]), .current(entry: pair(1, "08:30", "10:00"), next: pause("10:00", "10:10")))
        // Граница принадлежит следующему отрезку: в 10:00 уже перерыв.
        XCTAssertEqual(at("10:00", [0: day]), .current(entry: pause("10:00", "10:10"), next: pair(2, "10:10", "11:40")))
        XCTAssertEqual(at("11:00", [0: day]), .current(entry: pair(2, "10:10", "11:40"), next: nil))
    }

    func testAfterLastPairLooksAtFollowingDays() {
        XCTAssertEqual(at("11:40", [0: day, 2: [pair(3, "12:20", "13:50")]]), .upcoming(entry: pair(3, "12:20", "13:50"), dayOffset: 2))
        XCTAssertEqual(at("12:00", [0: day]), .free)
    }

    func testCancelledPairsDoNotStartTheDay() {
        let days = [0: [pair(1, "08:30", "10:00", .cancelled), pause("10:00", "10:10"), pair(2, "10:10", "11:40")]]
        XCTAssertEqual(at("09:00", days), .upcoming(entry: pair(2, "10:10", "11:40"), dayOffset: 0))
    }

    func testReminderSkipsRemotePairs() {
        let entries = [pair(1, "08:30", "10:00", .remote), pause("10:00", "10:10"), pair(2, "10:10", "11:40")]
        XCTAssertEqual(DayState.firstInPerson(entries), pair(2, "10:10", "11:40"))
    }

    func testTextsAreReadable() {
        XCTAssertEqual(DayState.boundaries(day), [m("08:30"), m("10:00"), m("10:10"), m("11:40")])
        XCTAssertEqual(DayState.duration(45), "45 мин")
        XCTAssertEqual(DayState.duration(90), "1 ч 30 мин")
        XCTAssertEqual(EntryText.span(pair(2, "10:10", "11:40")), "10:10 – 11:40, 1 ч 30 мин, каб. 102")
        XCTAssertEqual(EntryText.kind(pause("10:00", "10:10")), "перерыв")
    }
}
