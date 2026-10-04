package ru.yami.tkpst.data

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/** Всё приложение живёт по времени Тюмени (UTC+5), независимо от пояса телефона. */
val TYUMEN: ZoneId = ZoneId.of("Asia/Yekaterinburg")

data class Slot(val number: Int, val start: LocalTime, val end: LocalTime)

data class ClassHourSlot(val start: LocalTime, val end: LocalTime, val defaultTitle: String)

/** Расписание звонков ТКПСТ — перенесено с фото «Расписание звонков». */
object Bells {
    private fun t(s: String): LocalTime = LocalTime.parse(s)
    private fun slot(n: Int, a: String, b: String) = Slot(n, t(a), t(b))

    private val monday = listOf(
        slot(1, "08:30", "10:00"),
        slot(2, "10:10", "11:40"),
        slot(3, "12:20", "13:50"),
        slot(4, "14:35", "16:05"),
        slot(5, "16:15", "17:45"),
        slot(6, "17:50", "18:50"),
    )

    private val weekdays = listOf(
        slot(1, "08:15", "09:45"),
        slot(2, "09:55", "11:25"),
        slot(3, "12:05", "13:35"),
        slot(4, "13:45", "15:15"),
        slot(5, "15:40", "17:10"),
        slot(6, "17:20", "18:50"),
    )

    private val saturday = listOf(
        slot(1, "08:15", "09:15"),
        slot(2, "09:25", "10:25"),
        slot(3, "10:35", "11:35"),
        slot(4, "12:05", "13:05"),
        slot(5, "13:15", "14:15"),
        slot(6, "14:25", "15:25"),
    )

    val MORNING_CLASS_HOUR = ClassHourSlot(
        t("08:00"), t("08:30"),
        "Поднятие Государственного флага РФ · «Разговоры о важном»",
    )
    val AFTERNOON_CLASS_HOUR = ClassHourSlot(
        t("14:00"), t("14:30"),
        "Классный час «Разговоры о важном»",
    )

    /** Звонки по фото — без изменений из админки (по ним узнаём номер пары в данных колледжа). */
    fun pairs(day: DayOfWeek): List<Slot> = when (day) {
        DayOfWeek.MONDAY -> monday
        DayOfWeek.SATURDAY -> saturday
        DayOfWeek.SUNDAY -> emptyList()
        else -> weekdays
    }

    /** Классные часы по фото (для распознавания в данных колледжа). */
    fun classHours(day: DayOfWeek): List<ClassHourSlot> =
        if (day == DayOfWeek.MONDAY) listOf(MORNING_CLASS_HOUR, AFTERNOON_CLASS_HOUR) else emptyList()

    /** «8:05» / «08:05» → время (или null, если неверно). */
    fun parseHm(s: String?): LocalTime? {
        val m = Regex("^(\\d{1,2}):(\\d{2})(?::\\d{2})?$").matchEntire(s?.trim().orEmpty()) ?: return null
        val h = m.groupValues[1].toInt(); val min = m.groupValues[2].toInt()
        return if (h in 0..23 && min in 0..59) LocalTime.of(h, min) else null
    }

    private fun read(list: List<BellTime>?): List<Slot> {
        val out = mutableListOf<Slot>()
        for (x in list.orEmpty()) {
            val a = parseHm(x.start) ?: continue
            val b = parseHm(x.end) ?: continue
            if (x.number in 1..8 && b > a && out.none { it.number == x.number }) out += Slot(x.number, a, b)
        }
        return out.sortedBy { it.number }
    }

    private fun range(r: BellRange?, def: ClassHourSlot): ClassHourSlot {
        val a = parseHm(r?.start); val b = parseHm(r?.end)
        return if (a != null && b != null && b > a) def.copy(start = a, end = b) else def
    }

    /**
     * Звонки дня с изменениями из админки: общее «Расписание звонков» (bells)
     * и время пар на конкретную дату (days[дата].times).
     */
    fun pairs(day: DayOfWeek, date: LocalDate?, o: OverridesData): List<Slot> {
        val global = when (day) {
            DayOfWeek.MONDAY -> o.bells?.mon
            DayOfWeek.SATURDAY -> o.bells?.sat
            DayOfWeek.SUNDAY -> return emptyList()
            else -> o.bells?.week
        }
        var slots = read(global).ifEmpty { pairs(day) }
        val t = read(date?.let { o.day(it) }?.times)
        if (t.isNotEmpty()) {
            val byN = slots.associateBy { it.number }.toMutableMap()
            for (x in t) byN[x.number] = x
            slots = byN.values.sortedBy { it.number }
        }
        return slots
    }

    fun flag(o: OverridesData): ClassHourSlot = range(o.bells?.flag, MORNING_CLASS_HOUR)
    fun classHour(o: OverridesData): ClassHourSlot = range(o.bells?.classHour, AFTERNOON_CLASS_HOUR)
}
