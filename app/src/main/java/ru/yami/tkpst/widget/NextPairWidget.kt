package ru.yami.tkpst.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import ru.yami.tkpst.App
import ru.yami.tkpst.MainActivity
import ru.yami.tkpst.R
import ru.yami.tkpst.data.BreakKind
import ru.yami.tkpst.data.DayState
import ru.yami.tkpst.data.Entry
import ru.yami.tkpst.data.NowState
import ru.yami.tkpst.data.ScheduleNotifier
import ru.yami.tkpst.data.TYUMEN
import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Подписи занятий для виджета и напоминания. */
object Texts {
    private val hm = DateTimeFormatter.ofPattern("HH:mm")
    private val dayFormat = DateTimeFormatter.ofPattern("EE, d MMM", Locale.forLanguageTag("ru"))

    fun time(t: LocalTime): String = t.format(hm)

    fun title(e: Entry): String = when (e) {
        is Entry.Pair -> if (e.cancelled) "Пара отменена"
        else e.lessons.map { it.title }.filter { it.isNotBlank() }.distinct().joinToString(" / ").ifBlank { "${e.number} пара" }
        is Entry.ClassHour -> e.title.ifBlank { "Классный час" }
        is Entry.Break -> when (e.kind) {
            BreakKind.BIG -> "Большой перерыв"
            BreakKind.WINDOW -> "Окно"
            BreakKind.SHORT -> "Перерыв"
        }
    }

    fun cabinet(e: Entry): String = when (e) {
        is Entry.Pair -> when {
            e.cancelled -> ""
            e.remote -> "дистанционно"
            else -> e.lessons.map { it.cabinet }.filter { it.isNotBlank() }.distinct().joinToString(", ").let { if (it.isBlank()) "" else "каб. $it" }
        }
        is Entry.ClassHour -> if (e.cabinet.isBlank()) "" else "каб. ${e.cabinet}"
        is Entry.Break -> ""
    }

    /** Короткое имя для строки «Сейчас · …» и «Далее: …». */
    fun kind(e: Entry): String = when (e) {
        is Entry.Pair -> "${e.number} пара"
        is Entry.ClassHour -> "классный час"
        is Entry.Break -> title(e).lowercase(Locale.forLanguageTag("ru"))
    }

    /** «10:10 – 11:40 · 1 ч 30 мин · каб. 501». */
    fun span(e: Entry): String = listOf(
        "${time(e.start)} – ${time(e.end)}",
        DayState.duration(Duration.between(e.start, e.end).toMinutes()),
        cabinet(e),
    ).filter { it.isNotBlank() }.joinToString(" · ")

    fun day(date: LocalDate, today: LocalDate): String = when (date) {
        today -> "сегодня"
        today.plusDays(1) -> "завтра"
        else -> date.format(dayFormat)
    }
}

/** Виджет на главный экран: текущая пара или перерыв, либо ближайшая пара. */
class NextPairWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = ScheduleTicker.refresh(context)
    override fun onEnabled(context: Context) = ScheduleTicker.refresh(context)
    override fun onDisabled(context: Context) = ScheduleTicker.refresh(context)

    companion object {
        fun views(context: Context, state: NowState, now: LocalDateTime): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_next_pair)
            val open = PendingIntent.getActivity(
                context, 2001,
                Intent(context, MainActivity::class.java).putExtra(ScheduleNotifier.EXTRA_OPEN, "schedule")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.widget_root, open)

            // Цвета выбранной в приложении темы; без них остаются цвета по умолчанию из ресурсов.
            val theme = (context.applicationContext as App).settings.widgetColors.split(',')
                .mapNotNull { runCatching { Color.parseColor(it) }.getOrNull() }
            if (theme.size == 4) {
                val (background, text, muted, accent) = theme
                views.setInt(R.id.widget_bg, "setColorFilter", background)
                for (id in intArrayOf(R.id.widget_title, R.id.widget_time)) views.setTextColor(id, text)
                for (id in intArrayOf(R.id.widget_timer_label, R.id.widget_next)) views.setTextColor(id, muted)
                for (id in intArrayOf(R.id.widget_label, R.id.widget_timer)) views.setTextColor(id, accent)
            }

            fun timer(label: String, until: LocalDateTime?) {
                if (until == null) {
                    views.setViewVisibility(R.id.widget_timer_row, View.GONE)
                    return
                }
                val left = until.atZone(TYUMEN).toInstant().toEpochMilli() - System.currentTimeMillis()
                views.setViewVisibility(R.id.widget_timer_row, View.VISIBLE)
                views.setTextViewText(R.id.widget_timer_label, label)
                views.setChronometerCountDown(R.id.widget_timer, true)
                views.setChronometer(R.id.widget_timer, SystemClock.elapsedRealtime() + left, null, true)
            }

            when (state) {
                is NowState.Current -> {
                    val e = state.entry
                    views.setTextViewText(R.id.widget_label, "Сейчас · ${Texts.kind(e)}")
                    views.setTextViewText(R.id.widget_title, Texts.title(e))
                    views.setTextViewText(R.id.widget_time, Texts.span(e))
                    timer("до конца", now.toLocalDate().atTime(e.end))
                    val next = state.next
                    views.setTextViewText(
                        R.id.widget_next,
                        if (next == null) "Последнее занятие на сегодня"
                        else "Далее: " + listOf(
                            Texts.kind(next),
                            if (next is Entry.Break) DayState.duration(next.minutes) else Texts.title(next),
                            Texts.cabinet(next),
                        ).filter { it.isNotBlank() }.joinToString(" · "),
                    )
                }
                is NowState.Upcoming -> {
                    val e = state.entry
                    val start = state.date.atTime(e.start)
                    views.setTextViewText(R.id.widget_label, "Следующая · ${Texts.kind(e)} · ${Texts.day(state.date, now.toLocalDate())}")
                    views.setTextViewText(R.id.widget_title, Texts.title(e))
                    views.setTextViewText(R.id.widget_time, Texts.span(e))
                    // Обратный отсчёт имеет смысл, пока до начала меньше суток.
                    timer("до начала", start.takeIf { Duration.between(now, it).toHours() < 24 })
                    views.setTextViewText(R.id.widget_next, "ИС-25-3С")
                }
                NowState.Free -> {
                    views.setTextViewText(R.id.widget_label, "ИС-25-3С")
                    views.setTextViewText(R.id.widget_title, "Пар в ближайшие дни нет")
                    views.setTextViewText(R.id.widget_time, "Если расписание уже вышло, откройте приложение")
                    timer("", null)
                    views.setTextViewText(R.id.widget_next, "")
                }
            }
            return views
        }
    }
}
