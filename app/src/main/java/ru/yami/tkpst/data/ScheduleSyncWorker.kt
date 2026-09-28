package ru.yami.tkpst.data

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import ru.yami.tkpst.App
import java.time.DayOfWeek
import java.time.LocalDate
import java.util.concurrent.TimeUnit

/**
 * Фоновая синхронизация: раз в несколько часов скачивает текущую и следующую неделю,
 * чтобы новое расписание появлялось само и было доступно без интернета.
 */
class ScheduleSyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        val repo = (applicationContext as App).repository
        val ok = repo.prefetch(weeksToSync(LocalDate.now(TYUMEN)))
        return if (ok) Result.success() else Result.retry()
    }

    companion object {
        private const val NAME = "schedule-sync"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<ScheduleSyncWorker>(4, TimeUnit.HOURS)
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
                )
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        /** Пн–Сб текущей и следующей недели. */
        fun weeksToSync(today: LocalDate): List<LocalDate> {
            val monday = today.with(DayOfWeek.MONDAY)
            return (0L until 2L).flatMap { w -> (0L until 6L).map { monday.plusWeeks(w).plusDays(it) } }
        }
    }
}
