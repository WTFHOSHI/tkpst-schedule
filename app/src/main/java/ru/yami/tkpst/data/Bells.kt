package ru.yami.tkpst.data

import java.time.DayOfWeek
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

    fun pairs(day: DayOfWeek): List<Slot> = when (day) {
        DayOfWeek.MONDAY -> monday
        DayOfWeek.SATURDAY -> saturday
        DayOfWeek.SUNDAY -> emptyList()
        else -> weekdays
    }

    fun classHours(day: DayOfWeek): List<ClassHourSlot> =
        if (day == DayOfWeek.MONDAY) listOf(MORNING_CLASS_HOUR, AFTERNOON_CLASS_HOUR) else emptyList()
}
