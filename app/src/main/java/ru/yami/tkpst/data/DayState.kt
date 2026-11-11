package ru.yami.tkpst.data

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime

/** Что происходит прямо сейчас: для виджета и напоминаний. */
sealed interface NowState {
    /** Идёт пара, классный час или перерыв между ними. [next] — что будет сразу после. */
    data class Current(val entry: Entry, val next: Entry?) : NowState

    /** Занятий сейчас нет; [entry] — ближайшее занятие, [date] — его день. */
    data class Upcoming(val entry: Entry, val date: LocalDate) : NowState

    /** В ближайшие дни занятий нет или расписание ещё не загружено. */
    object Free : NowState
}

object DayState {
    /** Занятие, а не перерыв и не отменённая пара. */
    fun isLesson(e: Entry): Boolean = when (e) {
        is Entry.Break -> false
        is Entry.Pair -> !e.cancelled
        is Entry.ClassHour -> true
    }

    /**
     * Состояние на момент [now]. [days] отдаёт ленту дня (пары, классные часы и перерывы
     * по порядку) или пустой список, если расписания на день нет.
     */
    fun at(now: LocalDateTime, lookAheadDays: Long = 7, days: (LocalDate) -> List<Entry>): NowState {
        val date = now.toLocalDate()
        val time = now.toLocalTime()
        val today = days(date).sortedBy { it.start }
        val lessons = today.filter(::isLesson)
        if (lessons.isNotEmpty() && time < lessons.last().end) {
            val first = lessons.first()
            if (time < first.start) return NowState.Upcoming(first, date)
            // Учебный день идёт: всё между первым и последним занятием, включая перерывы и окна.
            val span = today.filter { it.start >= first.start && it.end <= lessons.last().end }
            val current = span.firstOrNull { time >= it.start && time < it.end }
            if (current != null) return NowState.Current(current, span.firstOrNull { it.start >= current.end })
            lessons.firstOrNull { it.start > time }?.let { return NowState.Upcoming(it, date) }
        }
        for (offset in 1..lookAheadDays) {
            val day = date.plusDays(offset)
            days(day).sortedBy { it.start }.firstOrNull(::isLesson)?.let { return NowState.Upcoming(it, day) }
        }
        return NowState.Free
    }

    /** Когда состояние сменится и виджет нужно перерисовать. */
    fun nextChange(now: LocalDateTime, state: NowState): LocalDateTime {
        val midnight = now.toLocalDate().plusDays(1).atTime(LocalTime.of(0, 1))
        val change = when (state) {
            is NowState.Current -> now.toLocalDate().atTime(state.entry.end)
            is NowState.Upcoming -> state.date.atTime(state.entry.start)
            NowState.Free -> midnight
        }
        // В полночь меняется подпись дня («завтра» становится «сегодня»).
        return if (change.isAfter(now) && change.isBefore(midnight)) change else midnight
    }

    /**
     * Ближайший момент напоминания: за [minutesBefore] минут до первого очного занятия дня.
     * Возвращает время напоминания и само занятие.
     */
    fun nextReminder(
        now: LocalDateTime,
        minutesBefore: Long = 10,
        lookAheadDays: Long = 7,
        days: (LocalDate) -> List<Entry>,
    ): Pair<LocalDateTime, Entry>? {
        for (offset in 0..lookAheadDays) {
            val day = now.toLocalDate().plusDays(offset)
            val first = days(day).sortedBy { it.start }.firstOrNull { it.isInPerson() } ?: continue
            val at = day.atTime(first.start).minusMinutes(minutesBefore)
            if (at.isAfter(now)) return at to first
        }
        return null
    }

    fun duration(minutes: Long): String {
        val h = minutes / 60
        val m = minutes % 60
        return when {
            h == 0L -> "$m мин"
            m == 0L -> "$h ч"
            else -> "$h ч $m мин"
        }
    }
}
