package ru.yami.tkpst.ui

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ru.yami.tkpst.App
import ru.yami.tkpst.data.HomeAddress
import ru.yami.tkpst.data.TYUMEN
import ru.yami.tkpst.data.Timeline
import ru.yami.tkpst.data.transit.Geo
import ru.yami.tkpst.data.transit.LatLng
import ru.yami.tkpst.data.transit.Network
import ru.yami.tkpst.data.transit.Plan
import ru.yami.tkpst.data.transit.Router
import ru.yami.tkpst.data.transit.Stop
import ru.yami.tkpst.data.transit.Walk
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime

enum class Direction(val title: String) { TO_COLLEGE("В колледж"), TO_HOME("Домой") }

data class RouteArrivals(val routeName: String, val times: List<LocalDateTime>, val useful: Boolean)

data class StopBoard(val stop: Stop, val walk: Walk, val arrivals: List<RouteArrivals>)

sealed interface BusState {
    data object NoHome : BusState
    data class LoadingNetwork(val done: Int, val total: Int) : BusState
    data object Searching : BusState
    data class Ready(
        val journeys: List<Router.Journey>,
        val boards: List<StopBoard>,
        val updatedAt: LocalDateTime,
        val noStopsNearby: Boolean,
    ) : BusState
    data class Error(val message: String) : BusState
}

class BusViewModel(app: Application) : AndroidViewModel(app) {

    private val a = app as App
    private val transit = a.transit

    var direction by mutableStateOf(autoDirection())
        private set
    var sort by mutableStateOf(Router.Sort.DURATION)
        private set
    var state by mutableStateOf<BusState>(BusState.Searching)
        private set
    var refreshing by mutableStateOf(false)
        private set

    private var job: Job? = null
    private var plansKey: String? = null
    private var plans: List<Plan> = emptyList()

    /** До конца сегодняшних пар — «В колледж», после — «Домой». */
    private fun autoDirection(): Direction {
        val today = LocalDate.now(TYUMEN)
        val now = LocalTime.now(TYUMEN)
        val lessons = a.repository.cached(today)?.lessons.orEmpty()
        val entries = Timeline.build(today, lessons)
        val end = entries.lastOrNull()?.end ?: LocalTime.of(14, 0)
        return if (now < end) Direction.TO_COLLEGE else Direction.TO_HOME
    }

    fun selectDirection(d: Direction) {
        if (d == direction) return
        direction = d
        refresh(showSpinner = true)
    }

    fun selectSort(s: Router.Sort) {
        if (s == sort) return
        sort = s
        refresh()
    }

    private fun endpoints(home: HomeAddress): Pair<LatLng, LatLng> = when (direction) {
        Direction.TO_COLLEGE -> home.point to Geo.COLLEGE
        Direction.TO_HOME -> Geo.COLLEGE to home.point
    }

    /** Полное обновление: онлайн-прогнозы запрашиваются заново. */
    fun refresh(force: Boolean = false, showSpinner: Boolean = false) {
        val home = a.settings.home
        if (home == null) {
            state = BusState.NoHome
            return
        }
        job?.cancel()
        if (force) transit.invalidateLive()
        if (showSpinner || state !is BusState.Ready) state = BusState.Searching
        refreshing = true
        job = viewModelScope.launch {
            var netLoaded = false
            try {
                // Прогресс приходит с фоновых потоков — запись в state через снапшоты безопасна.
                val net = transit.network { done, total -> state = BusState.LoadingNetwork(done, total) }
                netLoaded = true
                val (from, to) = endpoints(home)
                val key = "${net.data.date}|$direction|${home.point}"
                if (key != plansKey) {
                    if (state !is BusState.Ready) state = BusState.Searching
                    plans = withContext(Dispatchers.Default) { Router.findPlans(net, from, to) }
                    plansKey = key
                }
                state = compute(net, from)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                state = BusState.Error(
                    if (!netLoaded) "Не удалось загрузить маршруты. Проверь интернет."
                    else "Не удалось получить данные об автобусах."
                )
            } finally {
                refreshing = false
            }
        }
    }

    private suspend fun compute(net: Network, from: LatLng): BusState.Ready = coroutineScope {
        val now = LocalDateTime.now(TYUMEN)
        if (plans.isEmpty()) {
            return@coroutineScope BusState.Ready(emptyList(), boards(net, from, emptyList(), now), now, net.near(from, Router.ACCESS_RADIUS_M).isEmpty())
        }
        // Сначала параллельно берём онлайн-прогнозы для всех нужных остановок.
        val stopIds = plans.flatMap { p -> p.legs.map { it.from.id } }.distinct()
        stopIds.map { async { transit.live(it) } }.awaitAll()

        val source = transit.departureSource()
        val journeys = plans.map { p -> async { runCatching { Router.schedule(p, now, source) }.getOrNull() } }
            .awaitAll().filterNotNull()
        val ranked = Router.rank(journeys, sort, now, take = 5)
        BusState.Ready(ranked, boards(net, from, ranked, now), now, false)
    }

    /** «Ближайшие автобусы» на 2–3 остановках рядом с точкой отправления. */
    private suspend fun boards(net: Network, from: LatLng, journeys: List<Router.Journey>, now: LocalDateTime): List<StopBoard> {
        val near = net.near(from, Router.ACCESS_RADIUS_M)
        val usefulRoutes = journeys.flatMap { j -> listOf(j.legs.first().leg.routeName) + if (j.legs.size == 1) j.alternatives else emptyList() }.toSet()
        val routeNames = net.patterns.associate { it.routeId to it.routeName }

        val chosen = LinkedHashMap<Int, Stop>()
        // Остановки, с которых начинаются лучшие варианты — они в нужную сторону.
        journeys.map { it.legs.first().leg.from }.forEach { if (chosen.size < 3) chosen.putIfAbsent(it.id, it) }
        // Добиваем ближайшими, если на них есть другие маршруты.
        val covered = chosen.keys.flatMap { id -> net.byStop[id].orEmpty().map { net.patterns[it[0]].routeName } }.toMutableSet()
        for ((s, _) in near) {
            if (chosen.size >= 3) break
            if (s.id in chosen) continue
            val names = net.byStop[s.id].orEmpty().map { net.patterns[it[0]].routeName }.toSet()
            if (chosen.size < 2 || !covered.containsAll(names)) {
                chosen[s.id] = s
                covered += names
            }
        }
        return coroutineScope {
            chosen.values.map { s ->
                async {
                    val live = transit.live(s.id)
                    val arrivals = live.groupBy { routeNames[it.routeId] ?: "?" }
                        .map { (name, list) ->
                            RouteArrivals(name, list.map { it.time }.filter { !it.isBefore(now.minusMinutes(1)) }.take(3), name in usefulRoutes)
                        }
                        .filter { it.times.isNotEmpty() }
                        .sortedWith(compareBy<RouteArrivals> { !it.useful }.thenBy { it.times.first() })
                    val d = Geo.distanceM(from, s)
                    StopBoard(s, Walk(Geo.walkM(d).toInt(), Geo.walkMin(d)), arrivals)
                }
            }.awaitAll()
        }
    }
}
