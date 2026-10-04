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
    /** Пара добавлена в админ-панели (в колледже её не было). */
    val added: Boolean = false,
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
        /** Пара отменена (админ-панель). */
        val cancelled: Boolean = false,
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

/** Пара, на которую нужно прийти в колледж (не перерыв, не дистант и не отменена). */
fun Entry.isInPerson(): Boolean = when (this) {
    is Entry.Pair -> !remote && !cancelled
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

    private fun applyReplace(li: LessonInfo, t: String, c: String, te: String): LessonInfo {
        val nt = t.ifEmpty { li.title }; val nc = c.ifEmpty { li.cabinet }; val nte = te.ifEmpty { li.teacher }
        return LessonInfo(
            title = nt, cabinet = nc, teacher = nte, replaced = true,
            oldTitle = if (li.title != nt) li.title else li.oldTitle,
            oldCabinet = if (li.cabinet != nc) li.cabinet else li.oldCabinet,
            oldTeacher = if (li.teacher != nte) li.teacher else li.oldTeacher,
        )
    }

    /**
     * Строит ленту дня: пары (время — по звонкам, с изменениями из админки), поднятие флага,
     * классный час и перерывы/окна между ними.
     */
    fun build(date: LocalDate, apiLessons: List<ApiLesson>, overrides: OverridesData = Overrides.current): List<Entry> {
        val dow = date.dayOfWeek
        if (dow == DayOfWeek.SUNDAY) return emptyList()
        val ov = overrides.day(date)
        val lessons = if (ov?.replaceAll == true) emptyList() else apiLessons
        val forced = ov?.flag == true || ov?.classHour == true
        if (lessons.isEmpty() && ov?.pairs.isNullOrEmpty() && !forced) return emptyList()

        val baseSlots = Bells.pairs(dow)
        val pairSlots = Bells.pairs(dow, date, overrides)
        val chSlots = Bells.classHours(dow)
        val flagSlot = Bells.flag(overrides)
        val chSlot = Bells.classHour(overrides)
        fun chEntry(flag: Boolean, title: String = "", cabinet: String = ""): Entry.ClassHour {
            val s = if (flag) flagSlot else chSlot
            return Entry.ClassHour(s.start, s.end, title.ifEmpty { s.defaultTitle }, cabinet)
        }

        // Ключ: true — поднятие флага (утро), false — классный час (после обеда).
        val classHours = mutableMapOf<Boolean, Entry.ClassHour>()
        val pairs = sortedMapOf<Int, MutableList<LessonInfo>>()
        val customTimes = mutableMapOf<Int, kotlin.Pair<LocalTime, LocalTime>>()
        val noon = LocalTime.of(12, 0)

        // В понедельник API считает классный час 8:00 «первой парой» — номера сдвинуты.
        val mondayShift = dow == DayOfWeek.MONDAY && lessons.any {
            it.order == 1 && (isClassHourTitle(it.title) || parseTime(it.startTime) == Bells.MORNING_CLASS_HOUR.start)
        }

        for (l in lessons) {
            val st = parseTime(l.startTime)
            val exact = chSlots.firstOrNull { it.start == st }
            if (exact != null || isClassHourTitle(l.title)) {
                val slot = exact ?: chSlots.minByOrNull { s ->
                    if (st == null) Long.MAX_VALUE else abs(Duration.between(s.start, st).toMinutes())
                }
                val at = slot?.start ?: st ?: continue
                val isFlag = at < noon
                classHours[isFlag] = if (slot != null) chEntry(isFlag, clean(l.title), clean(l.cabinet))
                else Entry.ClassHour(at, parseTime(l.endTime) ?: at.plusMinutes(30), clean(l.title).ifEmpty { "Классный час" }, clean(l.cabinet))
                continue
            }

            // Номер пары узнаём по звонкам с фото (колледж отдаёт их время), показываем — по текущим звонкам.
            val number = baseSlots.firstOrNull { it.start == st }?.number
                ?: (if (mondayShift) l.order - 1 else l.order)
            if (number <= 0) continue
            if (pairSlots.none { it.number == number }) {
                // Нестандартная пара — берём время из API.
                val a = st ?: continue
                customTimes[number] = a to (parseTime(l.endTime) ?: a.plusMinutes(90))
            }
            pairs.getOrPut(number) { mutableListOf() }.add(toInfo(l))
        }

        // Изменения из админ-панели поверх данных колледжа
        val status = mutableMapOf<Int, String>()
        for (p in ov?.pairs.orEmpty()) {
            val n = p.number
            if (pairSlots.none { it.number == n }) continue
            val t = clean(p.title); val c = clean(p.cabinet); val te = clean(p.teacher)
            if (t.isNotEmpty() || c.isNotEmpty() || te.isNotEmpty()) {
                val cur = pairs[n]
                if (cur != null) pairs[n] = cur.map { applyReplace(it, t, c, te) }.toMutableList()
                else pairs[n] = mutableListOf(LessonInfo(t, c, te, added = ov?.replaceAll != true))
            }
            if (p.status == "remote" || p.status == "cancelled") status[n] = p.status
        }

        // Понедельник: флаг — если есть пары первой смены, классный час — если есть пары после 14:00.
        if (dow == DayOfWeek.MONDAY && pairs.isNotEmpty()) {
            if (true !in classHours && pairs.keys.any { it <= 3 }) classHours[true] = chEntry(true)
            if (false !in classHours && pairs.keys.any { it >= 4 }) classHours[false] = chEntry(false)
        }
        // Админ: добавить / убрать поднятие флага и классный час на этот день
        for ((isFlag, v) in listOf(true to ov?.flag, false to ov?.classHour)) {
            if (v == false) classHours.remove(isFlag)
            else if (v == true && isFlag !in classHours) classHours[isFlag] = chEntry(isFlag)
        }
        if (pairs.isEmpty() && classHours.isEmpty()) return emptyList()

        val main = buildList<Entry> {
            addAll(classHours.values)
            for ((n, infos) in pairs) {
                val slot = pairSlots.firstOrNull { it.number == n }
                val (s, e) = slot?.let { it.start to it.end } ?: customTimes.getValue(n)
                add(Entry.Pair(n, s, e, infos, remote = status[n] == "remote", cancelled = status[n] == "cancelled"))
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
