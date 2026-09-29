package ru.yami.tkpst.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.LocalTime

class TimelineTest {

    private fun t(s: String) = LocalTime.parse(s)
    private fun lesson(order: Int, start: String, end: String, title: String = "Предмет $order", replace: ApiReplace? = null) =
        ApiLesson(title, "101", "Иванов И.И.", order, "$start:00", "$end:00", replace)

    /** Реальный ответ API за понедельник 28.09.2026 (ИС-25-3С). */
    @Test
    fun monday_classHourIsNotAPair_andPairsFollowBells() {
        val lessons = listOf(
            ApiLesson("Классный час \"Разговоры о важном\"", "302-1", "", 1, "08:00:00", "08:30:00"),
            ApiLesson("ОГСЭ.04 Иностранный язык - 1 п/г", "302-1", "Зыкова Е.И.", 2, "08:30:00", "10:00:00"),
            ApiLesson("ОГСЭ.02 История", "306", "Ильина  Т.В.", 3, "10:10:00", "11:40:00"),
            ApiLesson("ОГСЭ.04 Иностранный язык - 2 п/г", "310", "Моргунова  А.Ю.", 4, "12:20:00", "13:50:00"),
        )
        val e = Timeline.build(LocalDate.of(2026, 9, 28), lessons)

        assertTrue(e[0] is Entry.ClassHour)
        assertEquals(t("08:00"), e[0].start)

        val pairs = e.filterIsInstance<Entry.Pair>()
        assertEquals(listOf(1, 2, 3), pairs.map { it.number })
        assertEquals(t("08:30"), pairs[0].start)
        assertEquals(t("12:20"), pairs[2].start)
        assertEquals("Ильина Т.В.", pairs[1].lessons[0].teacher) // двойные пробелы убраны

        val breaks = e.filterIsInstance<Entry.Break>()
        assertEquals(listOf(10L, 40L), breaks.map { it.minutes })
        assertEquals(BreakKind.BIG, breaks[1].kind)
        // Дневного классного часа нет: после 14:00 пар нет
        assertEquals(1, e.count { it is Entry.ClassHour })
    }

    @Test
    fun monday_afternoonClassHourInsertedForSecondShift() {
        val lessons = listOf(lesson(4, "14:35", "16:05"), lesson(5, "16:15", "17:45"))
        val e = Timeline.build(LocalDate.of(2026, 9, 28), lessons)
        val ch = e.filterIsInstance<Entry.ClassHour>()
        assertEquals(listOf(t("14:00")), ch.map { it.start })
        assertEquals(listOf(4, 5), e.filterIsInstance<Entry.Pair>().map { it.number })
        // 14:30 → 14:35 перерыв 5 минут
        assertEquals(5L, e.filterIsInstance<Entry.Break>().first().minutes)
    }

    @Test
    fun tuesday_breaksAndWindow() {
        val lessons = listOf(
            lesson(1, "08:15", "09:45"),
            lesson(2, "09:55", "11:25"),
            lesson(4, "13:45", "15:15"),
            lesson(5, "15:40", "17:10"),
        )
        val e = Timeline.build(LocalDate.of(2026, 9, 29), lessons)
        val breaks = e.filterIsInstance<Entry.Break>()
        assertEquals(BreakKind.SHORT, breaks[0].kind)   // 10 мин
        assertEquals(10L, breaks[0].minutes)
        assertEquals(BreakKind.WINDOW, breaks[1].kind)  // нет 3 пары
        assertEquals(BreakKind.BIG, breaks[2].kind)     // 25 мин
        assertEquals(25L, breaks[2].minutes)
    }

    @Test
    fun timesAlwaysFromBells_evenIfApiDiffers() {
        val lessons = listOf(ApiLesson("X", "1", "Y", 3, "12:00:00", "13:30:00"))
        val p = Timeline.build(LocalDate.of(2026, 9, 30), lessons).single() as Entry.Pair
        assertEquals(t("12:05"), p.start)
        assertEquals(t("13:35"), p.end)
    }

    @Test
    fun saturday_bells() {
        val lessons = listOf(lesson(3, "10:35", "11:35"), lesson(4, "12:05", "13:05"))
        val e = Timeline.build(LocalDate.of(2026, 10, 3), lessons)
        val br = e.filterIsInstance<Entry.Break>().single()
        assertEquals(30L, br.minutes)
        assertEquals(BreakKind.BIG, br.kind)
    }

    @Test
    fun sunday_isEmpty() {
        assertTrue(Timeline.build(LocalDate.of(2026, 10, 4), listOf(lesson(1, "08:15", "09:45"))).isEmpty())
    }

    @Test
    fun replacement() {
        val l = lesson(1, "08:15", "09:45", title = "Старый", replace = ApiReplace(title = "Новый", cabinet = null, teacher = "Петров"))
        val p = Timeline.build(LocalDate.of(2026, 9, 29), listOf(l)).single() as Entry.Pair
        val info = p.lessons.single()
        assertTrue(info.replaced)
        assertEquals("Новый", info.title)
        assertEquals("Старый", info.oldTitle)
        assertEquals("101", info.cabinet)
        assertEquals(null, info.oldCabinet)
        assertEquals("Петров", info.teacher)
    }

    @Test
    fun subgroupsInSamePair() {
        val lessons = listOf(lesson(2, "09:55", "11:25", "A"), lesson(2, "09:55", "11:25", "B"))
        val p = Timeline.build(LocalDate.of(2026, 9, 29), lessons).single() as Entry.Pair
        assertEquals(2, p.lessons.size)
    }

    @Test
    fun formatLeft() {
        assertEquals("меньше минуты", Timeline.formatLeft(30))
        assertEquals("1 мин", Timeline.formatLeft(60))
        assertEquals("2 мин", Timeline.formatLeft(61))
        assertEquals("1 ч 20 мин", Timeline.formatLeft(80 * 60))
        assertEquals("2 ч", Timeline.formatLeft(120 * 60))
    }

    @Test
    fun adminOverrides() {
        val wed = listOf(lesson(2, "09:55", "11:25", "Практика"), lesson(3, "12:05", "13:35", "Бизнес"), lesson(4, "13:45", "15:15", "Интерфейсы"))
        val ov = OverridesData(days = mapOf("2026-09-30" to OverrideDay(pairs = listOf(
            OverridePair(2, status = "remote"),
            OverridePair(3, status = "cancelled"),
            OverridePair(4, title = "Графический дизайн", cabinet = "501"),
            OverridePair(5, title = "Новая пара", cabinet = "204", teacher = "Т."),
        ))))
        val e = Timeline.build(LocalDate.of(2026, 9, 30), wed, ov)
        val p = e.filterIsInstance<Entry.Pair>().associateBy { it.number }
        assertTrue(p.getValue(2).remote)
        assertTrue(p.getValue(3).cancelled)
        assertEquals("Графический дизайн", p.getValue(4).lessons[0].title)
        assertEquals("Интерфейсы", p.getValue(4).lessons[0].oldTitle)
        assertEquals("501", p.getValue(4).lessons[0].cabinet)
        assertTrue(p.getValue(5).lessons[0].added)
        assertEquals(t("15:40"), p.getValue(5).start)
        assertEquals(listOf(4, 5), e.filter { it.isInPerson() }.map { (it as Entry.Pair).number })
        // в другой день изменений нет
        assertTrue(Timeline.build(LocalDate.of(2026, 10, 7), wed, ov).filterIsInstance<Entry.Pair>().none { it.remote || it.cancelled })
        // своё расписание, когда колледж ничего не прислал / вместо данных колледжа
        val own = OverridesData(days = mapOf("2026-10-01" to OverrideDay(replaceAll = true, pairs = listOf(OverridePair(1, title = "Своя пара", cabinet = "1")))))
        val o = Timeline.build(LocalDate.of(2026, 10, 1), emptyList(), own).filterIsInstance<Entry.Pair>().single()
        assertEquals("Своя пара", o.lessons[0].title)
        assertEquals(false, o.lessons[0].added)
        assertEquals(1, Timeline.build(LocalDate.of(2026, 10, 1), listOf(lesson(3, "12:05", "13:35")), own).count { it is Entry.Pair })
    }
}
