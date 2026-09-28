package ru.yami.tkpst.data

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import ru.yami.tkpst.MainActivity
import ru.yami.tkpst.R
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Уведомления о новом и изменённом расписании. */
object ScheduleNotifier {
    private const val CHANNEL = "schedule_changes"
    private const val ID_PUBLISHED = 1001
    private const val ID_CHANGED = 1002
    const val EXTRA_OPEN = "open"

    private val fmt = DateTimeFormatter.ofPattern("EE d MMM", Locale.forLanguageTag("ru"))

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL, "Изменения в расписании", NotificationManager.IMPORTANCE_DEFAULT)
            ch.description = "Новое расписание на неделю, замены и перенос кабинетов"
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
    }

    private fun canNotify(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun notify(context: Context, changes: Map<LocalDate, DayChange>) {
        if (changes.isEmpty() || !canNotify(context)) return
        ensureChannel(context)
        val published = changes.filterValues { it == DayChange.PUBLISHED }.keys.sorted()
        val changed = changes.filterValues { it == DayChange.CHANGED }.keys.sorted()
        if (published.isNotEmpty()) {
            val text = if (published.size == 1) published.first().format(fmt)
            else "${published.first().format(fmt)} – ${published.last().format(fmt)}"
            post(context, ID_PUBLISHED, "Вышло новое расписание", "ИС-25-3С: $text")
        }
        if (changed.isNotEmpty()) {
            post(
                context, ID_CHANGED, "Изменения в расписании",
                "ИС-25-3С: " + changed.joinToString(", ") { it.format(fmt) },
            )
        }
    }

    private fun post(context: Context, id: Int, title: String, text: String) {
        val intent = Intent(context, MainActivity::class.java)
            .putExtra(EXTRA_OPEN, "schedule")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pi = PendingIntent.getActivity(
            context, id, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(id, n)
        } catch (_: SecurityException) {
        }
    }
}
