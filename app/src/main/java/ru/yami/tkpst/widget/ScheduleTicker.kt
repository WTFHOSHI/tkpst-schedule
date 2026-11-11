package ru.yami.tkpst.widget

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import ru.yami.tkpst.App
import ru.yami.tkpst.MainActivity
import ru.yami.tkpst.R
import ru.yami.tkpst.data.DayState
import ru.yami.tkpst.data.Entry
import ru.yami.tkpst.data.ScheduleNotifier
import ru.yami.tkpst.data.TYUMEN
import ru.yami.tkpst.data.Timeline
import java.time.LocalDate
import java.time.LocalDateTime

/**
 * Держит виджет и напоминание в актуальном состоянии: перерисовывает виджет на границах
 * пар и перерывов и ставит будильник за 10 минут до первой пары.
 */
object ScheduleTicker {
    const val ACTION_TICK = "ru.yami.tkpst.action.WIDGET_TICK"
    const val ACTION_REMIND = "ru.yami.tkpst.action.PAIR_REMINDER"
    private const val CHANNEL = "pair_reminder"
    private const val ID_REMINDER = 1003

    /** Лента дня из сохранённого на телефоне расписания (без обращения к сети). */
    fun days(context: Context): (LocalDate) -> List<Entry> {
        val app = context.applicationContext as App
        app.overrides // изменения из админ-панели должны быть загружены до построения ленты
        return { date -> app.repository.cached(date)?.let { Timeline.build(date, it.lessons) }.orEmpty() }
    }

    fun refresh(context: Context) {
        val app = context.applicationContext
        val now = LocalDateTime.now(TYUMEN)
        val days = runCatching { days(app) }.getOrNull() ?: return
        val manager = AppWidgetManager.getInstance(app)
        val ids = manager.getAppWidgetIds(ComponentName(app, NextPairWidget::class.java))
        val tick = pending(app, ACTION_TICK)
        if (ids.isNotEmpty()) {
            val state = DayState.at(now, days = days)
            for (id in ids) manager.updateAppWidget(id, NextPairWidget.views(app, state, now))
            setAlarm(app, DayState.nextChange(now, state), tick, wake = false)
        } else {
            app.getSystemService(AlarmManager::class.java).cancel(tick)
        }
        val remind = pending(app, ACTION_REMIND)
        val next = if ((app as App).settings.reminder) DayState.nextReminder(now, days = days) else null
        if (next != null) setAlarm(app, next.first, remind, wake = true)
        else app.getSystemService(AlarmManager::class.java).cancel(remind)
    }

    private fun pending(context: Context, action: String): PendingIntent = PendingIntent.getBroadcast(
        context, 0, Intent(context, ScheduleTickReceiver::class.java).setAction(action),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun setAlarm(context: Context, at: LocalDateTime, intent: PendingIntent, wake: Boolean) {
        val alarms = context.getSystemService(AlarmManager::class.java)
        val millis = at.atZone(TYUMEN).toInstant().toEpochMilli()
        val type = if (wake) AlarmManager.RTC_WAKEUP else AlarmManager.RTC
        val exact = Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms()
        try {
            if (exact) alarms.setExactAndAllowWhileIdle(type, millis, intent)
            else alarms.setAndAllowWhileIdle(type, millis, intent)
        } catch (_: SecurityException) {
            // Точные будильники запрещены в настройках телефона: сработает с небольшой задержкой.
            alarms.setAndAllowWhileIdle(type, millis, intent)
        }
    }

    /** Показывает напоминание, если до первой пары действительно осталось около десяти минут. */
    fun remind(context: Context) {
        val app = context.applicationContext as App
        if (!app.settings.reminder) return
        val now = LocalDateTime.now(TYUMEN)
        val today = runCatching { days(app)(now.toLocalDate()) }.getOrNull().orEmpty()
        val first = today.sortedBy { it.start }.firstOrNull { e ->
            (e is Entry.Pair && !e.remote && !e.cancelled) || e is Entry.ClassHour
        } ?: return
        val minutes = java.time.Duration.between(now.toLocalTime(), first.start).toMinutes()
        // Будильник мог опоздать или расписание могло измениться — не напоминаем о прошедшем.
        if (minutes < 0 || minutes > 15) return
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(app, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL, "Напоминание перед первой парой", NotificationManager.IMPORTANCE_HIGH)
            channel.description = "За 10 минут до начала занятий"
            app.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
        val title = when (first) {
            is Entry.Pair -> "${first.number} пара в ${Texts.time(first.start)}"
            else -> "Классный час в ${Texts.time(first.start)}"
        }
        val text = listOf(Texts.title(first), Texts.cabinet(first)).filter { it.isNotBlank() }.joinToString(" · ")
        val open = PendingIntent.getActivity(
            app, ID_REMINDER,
            Intent(app, MainActivity::class.java).putExtra(ScheduleNotifier.EXTRA_OPEN, "schedule")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(app, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(if (minutes > 0) "Через $minutes мин: $title" else title)
            .setContentText(text)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(open)
            .setAutoCancel(true)
            .setTimeoutAfter(2 * 60 * 60 * 1000L)
            .build()
        try {
            NotificationManagerCompat.from(app).notify(ID_REMINDER, notification)
        } catch (_: SecurityException) {
        }
    }
}

/** Будильники виджета и напоминания, а также перезагрузка телефона и смена времени. */
class ScheduleTickReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ScheduleTicker.ACTION_REMIND) ScheduleTicker.remind(context)
        ScheduleTicker.refresh(context)
    }
}
