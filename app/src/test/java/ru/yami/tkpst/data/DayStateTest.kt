package ru.yami.tkpst.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime

class DayStateTest {
    private fun t(s: String) = LocalTime.parse(s)
    private fun pair(n: Int, a: String, b: String, cancelled: Boolean = false, remote: Boolean = false) =
        Entry.Pair(n, t(a), t(b), listOf(LessonInfo("Предмет $n", "10$n", "")), remote = remote, cancelled = cancelled)
    private fun brk(a: String, b: String) = Entry.Break(t(a), t(b), BreakKind.SHORT)

    private val tuesday = LocalDate.of(2026, 11, 10)
    private val day = listOf(pair(1, "08:30", "10:00"), brk("10:00", "10:10"), pair(2, "10:10", "11:40"))
    private fun days(map: Map<LocalDate, List<Entry>>): (LocalDate) -> List<Entry> = { map[it].orEmpty() }
    private fun at(time: String, map: Map<LocalDate, List<Entry>> = mapOf(tuesday to day)) =
        DayState.at(LocalDateTime.of(tuesday, t(time)), days = days(map))

    @Test
    fun beforeFirstPair_showsItAsUpcoming() {
        val s = at("07:00") as NowState.Upcoming
        assertEquals(1, (s.entry as Entry.Pair).number)
        assertEquals(tuesday, s.date)
    }

    @Test
    fun switchesBetweenPairAndBreak() {
        val first = at("09:15") as NowState.Current
        assertEquals(1, (first.entry as Entry.Pair).number)
        assertTrue(first.next is Entry.Break)

        // Граница принадлежит следующему отрезку: в 10:00 уже перерыв.
        val pause = at("10:00") as NowState.Current
        assertTrue(pause.entry is Entry.Break)
        assertEquals(2, (pause.next as Entry.Pair).number)

        val last = at("11:00") as NowState.Current
        assertEquals(2, (last.entry as Entry.Pair).number)
        assertNull(last.next)
    }

    @Test
    fun afterLastPair_looksAtFollowingDays() {
        val thursday = tuesday.plusDays(2)
        val s = at("11:40", mapOf(tuesday to day, thursday to listOf(pair(3, "12:20", "13:50")))) as NowState.Upcoming
        assertEquals(thursday, s.date)
        assertEquals(3, (s.entry as Entry.Pair).number)
        assertEquals(NowState.Free, at("12:00"))
    }

    @Test
    fun cancelledPairsDoNotStartOrEndTheDay() {
        val map = mapOf(tuesday to listOf(pair(1, "08:30", "10:00", cancelled = true), brk("10:00", "10:10"), pair(2, "10:10", "11:40")))
        val early = at("09:00", map) as NowState.Upcoming
        assertEquals(2, (early.entry as Entry.Pair).number)
    }

    @Test
    fun nextChangeIsTheEndOfTheCurrentEntryOrMidnight() {
        val now = LocalDateTime.of(tuesday, t("09:15"))
        assertEquals(LocalDateTime.of(tuesday, t("10:00")), DayState.nextChange(now, DayState.at(now, days = days(mapOf(tuesday to day)))))
        val evening = LocalDateTime.of(tuesday, t("20:00"))
        val state = DayState.at(evening, days = days(mapOf(tuesday.plusDays(1) to day)))
        assertEquals(LocalDateTime.of(tuesday.plusDays(1), t("00:01")), DayState.nextChange(evening, state))
    }

    @Test
    fun reminderIsTenMinutesBeforeTheFirstInPersonLesson() {
        val map = mapOf(tuesday to listOf(pair(1, "08:30", "10:00", remote = true), brk("10:00", "10:10"), pair(2, "10:10", "11:40")))
        val (time, entry) = DayState.nextReminder(LocalDateTime.of(tuesday, t("07:00")), days = days(map))!!
        assertEquals(LocalDateTime.of(tuesday, t("10:00")), time)
        assertEquals(2, (entry as Entry.Pair).number)
        // Время напоминания прошло — берётся следующий учебный день.
        val later = DayState.nextReminder(LocalDateTime.of(tuesday, t("10:00")), days = days(map + (tuesday.plusDays(1) to day)))!!
        assertEquals(LocalDateTime.of(tuesday.plusDays(1), t("08:20")), later.first)
        assertNull(DayState.nextReminder(LocalDateTime.of(tuesday, t("12:00")), days = days(map)))
    }

    @Test
    fun durationIsReadable() {
        assertEquals("45 мин", DayState.duration(45))
        assertEquals("1 ч 30 мин", DayState.duration(90))
        assertEquals("2 ч", DayState.duration(120))
    }
}
