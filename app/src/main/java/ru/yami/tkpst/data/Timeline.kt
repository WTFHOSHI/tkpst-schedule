package ru.yami.tkpst.data

import java.time.DayOfWeek
import java.time.Duration
import java.time.LocalDate
import java.time.LocalTime
import kotlin.math.abs

/** Один предмет внутри пары (у подгрупп может быть несколько в одно время). */
data class LessonInfo(
    val title: String,
    val cabinet: String,
    val teacher: String,
    /** Была замена — старые значения ниже (для зачёркивания). */
    val replaced: Boolean = false,
    val oldTitle: String? = null,
    val oldCabinet: String? = null,
    val oldTeacher: String? = null,
)

enum class BreakKind { SHORT, BIG, WINDOW }

sealed interface Entry {
    val start: LocalTime
    val end: LocalTime

    data class Pair(
        val number: Int,
        override val start: LocalTime,
        override val end: LocalTime,
        val lessons: List<LessonInfo>,
        /** Пара дистанционно — в колледж идти не нужно. */
        val remote: Boolean = false,
    ) : Entry

    data class ClassHour(
        override val start: LocalTime,
        override val end: LocalTime,
        val title: String,
        val cabinet: String,
    ) : Entry

    data class Break(
        override val start: LocalTime,
        override val end: LocalTime,
        val kind: BreakKind,
    ) : Entry {
        val minutes: Long get() = Duration.between(start, end).toMinutes()
    }
}

/** Разовые изменения, которых нет в API колледжа. */
object Overrides {
    /** Дистанционные пары: дата → номера пар. */
    private val REMOTE: Map<LocalDate, Set<Int>> = mapOf(
        LocalDate.of(2026, 9, 30) to setOf(2, 3),
    )

    fun remotePairs(date: LocalDate): Set<Int> = REMOTE[date].orEmpty()
}

/** Пара, на которую нужно прийти в колледж (не перерыв и не дистант). */
fun Entry.isInPerson(): Boolean = when (this) {
    is Entry.Pair -> !remote
    is Entry.ClassHour -> true
    is Entry.Break -> false
}

object Timeline {

    private fun parseTime(s: String?): LocalTime? =
        s?.trim()?.takeIf { it.isNotEmpty() }?.let {
            runCatching { LocalTime.parse(if (it.length == 5) "$it:00" else it) }.getOrNull()
        }

    private fun clean(s: String?): String = s?.replace(Regex("\\s+"), " ")?.trim().orEmpty()

    private fun isClassHourTitle(title: String) = title.contains("классный час", ignoreCase = true)

    private fun toInfo(l: ApiLesson): LessonInfo {
        val r = l.replace
        val title = clean(l.title)
        val cabinet = clean(l.cabinet)
        val teacher = clean(l.teacher)
        if (r == null) return LessonInfo(title, cabinet, teacher)
        val newTitle = clean(r.title).ifEmpty { title }
        val newCab = clean(r.cabinet).ifEmpty { cabinet }
        val newTeacher = clean(r.teacher).ifEmpty { teacher }
        return LessonInfo(
            title = newTitle,
            cabinet = newCab,
            teacher = newTeacher,
            replaced = true,
            oldTitle = title.takeIf { it != newTitle },
            oldCabinet = cabinet.takeIf { it != newCab },
            oldTeacher = teacher.takeIf { it != newTeacher },
        )
    }

    /**
     * Строит ленту дня: пары (время — по звонкам с фото), классные часы понедельника
     * и перерывы/окна между ними.
     */
    fun build(date: LocalDate, lessons: List<ApiLesson>): List<Entry> {
        val dow = date.dayOfWeek
        if (dow == DayOfWeek.SUNDAY || lessons.isEmpty()) return emptyList()

        val pairSlots = Bells.pairs(dow)
        val chSlots = Bells.classHours(dow)

        val classHours = mutableMapOf<LocalTime, Entry.ClassHour>()
        val pairs = sortedMapOf<Int, MutableList<LessonInfo>>()
        val customTimes = mutableMapOf<Int, kotlin.Pair<LocalTime, LocalTime>>()

        // В понедельник API считает классный час 8:00 «первой парой» — номера сдвинуты.
        val mondayShift = dow == DayOfWeek.MONDAY && lessons.any {
            it.order == 1 && (isClassHourTitle(it.title) || parseTime(it.startTime) == Bells.MORNING_CLASS_HOUR.start)
        }

        for (l in lessons) {
            val st = parseTime(l.startTime)
            val chSlot = chSlots.firstOrNull { it.start == st }
            if (chSlot != null || isClassHourTitle(l.title)) {
                val slot = chSlot ?: chSlots.minByOrNull { s ->
                    if (st == null) Long.MAX_VALUE else abs(Duration.between(s.start, st).toMinutes())
                }
                val start = slot?.start ?: st ?: continue
                val end = slot?.end ?: parseTime(l.endTime) ?: start.plusMinutes(30)
                classHours[start] = Entry.ClassHour(
                    start, end,
                    title = clean(l.title).ifEmpty { slot?.defaultTitle ?: "Классный час" },
                    cabinet = clean(l.cabinet),
                )
                continue
            }

            val number = pairSlots.firstOrNull { it.start == st }?.number
                ?: (if (mondayShift) l.order - 1 else l.order)
            if (number <= 0) continue
            if (pairSlots.none { it.number == number }) {
                // Нестандартная пара — берём время из API.
                val a = st ?: continue
                customTimes[number] = a to (parseTime(l.endTime) ?: a.plusMinutes(90))
            }
            pairs.getOrPut(number) { mutableListOf() }.add(toInfo(l))
        }

        // Классные часы понедельника показываем, даже если API их не прислал:
        // утренний — если есть пары первой смены, дневной — если есть пары после 14:00.
        if (dow == DayOfWeek.MONDAY && pairs.isNotEmpty()) {
            val m = Bells.MORNING_CLASS_HOUR
            val a = Bells.AFTERNOON_CLASS_HOUR
            if (m.start !in classHours && pairs.keys.any { it <= 3 }) {
                classHours[m.start] = Entry.ClassHour(m.start, m.end, m.defaultTitle, "")
            }
            if (a.start !in classHours && pairs.keys.any { it >= 4 }) {
                classHours[a.start] = Entry.ClassHour(a.start, a.end, a.defaultTitle, "")
            }
        }

        val main = buildList<Entry> {
            addAll(classHours.values)
            for ((n, infos) in pairs) {
                val slot = pairSlots.firstOrNull { it.number == n }
                val (s, e) = slot?.let { it.start to it.end } ?: customTimes.getValue(n)
                add(Entry.Pair(n, s, e, infos, remote = n in Overrides.remotePairs(date)))
            }
        }.sortedBy { it.start }

        val result = mutableListOf<Entry>()
        for ((i, e) in main.withIndex()) {
            if (i > 0) {
                val prev = main[i - 1]
                val gap = Duration.between(prev.end, e.start).toMinutes()
                if (gap > 0) {
                    val skipped = pairSlots.any { it.start >= prev.end && it.end <= e.start }
                    val kind = when {
                        skipped -> BreakKind.WINDOW
                        gap >= 25 -> BreakKind.BIG
                        else -> BreakKind.SHORT
                    }
                    result += Entry.Break(prev.end, e.start, kind)
                }
            }
            result += e
        }
        return result
    }

    /** «1 ч 20 мин», «45 мин», «меньше минуты». Минуты округляются вверх. */
    fun formatLeft(seconds: Long): String {
        if (seconds < 60) return "меньше минуты"
        val totalMin = (seconds + 59) / 60
        val h = totalMin / 60
        val m = totalMin % 60
        return when {
            h > 0 && m > 0 -> "$h ч $m мин"
            h > 0 -> "$h ч"
            else -> "$m мин"
        }
    }
}
