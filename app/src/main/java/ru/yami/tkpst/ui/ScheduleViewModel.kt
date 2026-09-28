package ru.yami.tkpst.ui

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import ru.yami.tkpst.App
import ru.yami.tkpst.data.DayData
import ru.yami.tkpst.data.Entry
import ru.yami.tkpst.data.ScheduleNotifier
import ru.yami.tkpst.data.ScheduleSyncWorker
import ru.yami.tkpst.data.TYUMEN
import ru.yami.tkpst.data.Timeline
import java.time.DayOfWeek
import java.time.LocalDate

sealed interface DayState {
    data object Loading : DayState
    data class Loaded(val entries: List<Entry>, val data: DayData) : DayState
    data class Error(val message: String) : DayState
}

class ScheduleViewModel(app: Application) : AndroidViewModel(app) {

    private val repo = (app as App).repository

    fun today(): LocalDate = LocalDate.now(TYUMEN)

    var selected by mutableStateOf(today())
        private set

    /** Понедельник показываемой недели. В воскресенье — текущая (уходящая) неделя. */
    var weekStart by mutableStateOf(today().with(DayOfWeek.MONDAY))
        private set

    var state by mutableStateOf<DayState>(DayState.Loading)
        private set

    var refreshing by mutableStateOf(false)
        private set

    private var job: Job? = null
    private var prefetchJob: Job? = null

    /**
     * Вызывается при каждом открытии/возврате в приложение:
     * обновляет выбранный день и тихо докачивает текущую и следующую неделю.
     */
    fun onResume() {
        load(selected)
        if (prefetchJob?.isActive != true) {
            prefetchJob = viewModelScope.launch {
                val t = today()
                val changes = repo.prefetch(ScheduleSyncWorker.weeksToSync(t).filter { it != selected }, t)
                if (changes != null) ScheduleNotifier.notify(getApplication(), changes)
            }
        }
    }

    fun select(date: LocalDate) {
        if (date == selected && state !is DayState.Error) return
        selected = date
        weekStart = date.with(DayOfWeek.MONDAY)
        load(date)
    }

    fun shiftWeek(weeks: Long) {
        val newStart = weekStart.plusWeeks(weeks)
        val offset = if (selected.dayOfWeek == DayOfWeek.SUNDAY) 0L
        else (selected.dayOfWeek.value - 1).toLong()
        // Если листаем на неделю с сегодняшним днём — встаём на сегодня.
        val t = today()
        val target = if (t.with(DayOfWeek.MONDAY) == newStart && t.dayOfWeek != DayOfWeek.SUNDAY) t
        else newStart.plusDays(offset)
        select(target)
    }

    fun goToday() = select(today())

    fun refresh() = load(selected, userRefresh = true)

    private fun load(date: LocalDate, userRefresh: Boolean = false) {
        job?.cancel()
        if (date.dayOfWeek == DayOfWeek.SUNDAY) {
            state = DayState.Loaded(emptyList(), DayData(emptyList(), false, 0, false))
            return
        }
        // Сначала мгновенно показываем кэш, потом обновляем из сети.
        val cached = repo.cached(date)
        state = when {
            cached != null -> DayState.Loaded(Timeline.build(date, cached.lessons), cached)
            else -> DayState.Loading
        }
        refreshing = userRefresh || cached != null
        job = viewModelScope.launch {
            state = try {
                val d = repo.load(date)
                DayState.Loaded(Timeline.build(date, d.lessons), d)
            } catch (e: Exception) {
                val c = repo.cached(date)
                if (c != null) DayState.Loaded(Timeline.build(date, c.lessons), c)
                else DayState.Error("Нет соединения с сервером расписания")
            }
            refreshing = false
        }
    }
}
