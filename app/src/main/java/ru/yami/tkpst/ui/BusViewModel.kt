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

/** Когда ехать — как в 2ГИС. */
enum class WhenMode(val title: String) { NOW("Сейчас"), DEPART("Выехать в"), ARRIVE("Приехать к") }

/** day: 0 — сегодня, 1 — завтра. */
data class WhenSpec(val mode: WhenMode = WhenMode.NOW, val day: Int = 0, val time: LocalTime = LocalTime.of(8, 0))

/** Подсказка «к 1-й паре» / «после пар». */
data class QuickWhen(val spec: WhenSpec, val label: String)

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
        val whenSpec: WhenSpec = WhenSpec(),
        /** Выбранный момент для «выехать в» / «приехать к». */
        val target: LocalDateTime? = null,
        /** «Приехать к» уже прошло. */
        val past: Boolean = false,
    ) : BusState
    data class Error(val message: String) : BusState
}

/** Сервер Тюменьгортранса не отвечает на зарубежные подключения. */
const val VPN_HINT = "Похоже, сервер Тюменьгортранса сейчас не работает — проверь, открывается ли расписание на tgt72.ru. " +
    "Попробуй позже. Если включён VPN — выключи его: сервер отвечает только на подключения из России."

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
    var whenSpec by mutableStateOf(WhenSpec())
        private set

    fun target(spec: WhenSpec = whenSpec): LocalDateTime =
        LocalDate.now(TYUMEN).plusDays(spec.day.toLong()).atTime(spec.time)

    /** Если выбранное время сегодня уже прошло — значит, имеется в виду завтра. */
    private fun normalized(spec: WhenSpec): WhenSpec =
        if (spec.mode != WhenMode.NOW && spec.day == 0 && target(spec).isBefore(LocalDateTime.now(TYUMEN))) spec.copy(day = 1)
        else spec

    fun setWhen(spec: WhenSpec) {
        val n = normalized(spec)
        if (n == whenSpec) return
        whenSpec = n
        refresh(showSpinner = true)
    }

    fun selectMode(mode: WhenMode) {
        if (mode == whenSpec.mode) return
        var spec = whenSpec.copy(mode = mode)
        if (whenSpec.mode == WhenMode.NOW && mode != WhenMode.NOW) {
            // Разумное время по умолчанию: подсказка по расписанию или через час
            val q = quickWhen()
            spec = if (q != null && q.spec.mode == mode) q.spec
            else {
                val t = LocalDateTime.now(TYUMEN).plusHours(1)
                val rounded = t.toLocalTime().withSecond(0).withNano(0).let { it.withMinute(it.minute / 5 * 5) }
                WhenSpec(mode, if (t.toLocalDate().isAfter(LocalDate.now(TYUMEN))) 1 else 0, rounded)
            }
        }
        setWhen(spec)
    }

    /** К первой паре (в колледж) или после последней пары (домой) — сегодня или завтра. */
    fun quickWhen(): QuickWhen? {
        val now = LocalDateTime.now(TYUMEN)
        for (add in 0..1) {
            val day = now.toLocalDate().plusDays(add.toLong())
            if (day.dayOfWeek == java.time.DayOfWeek.SUNDAY) continue
            val entries = Timeline.build(day, a.repository.cached(day)?.lessons.orEmpty())
            if (entries.isEmpty()) continue
            val suffix = if (add == 1) " завтра" else ""
            if (direction == Direction.TO_COLLEGE) {
                val first = entries.first()
                if (day.atTime(first.start).isBefore(now.plusMinutes(20))) continue
                val title = if (first is ru.yami.tkpst.data.Entry.Pair) "К ${first.number}-й паре" else "К классному часу"
                return QuickWhen(WhenSpec(WhenMode.ARRIVE, add, first.start.minusMinutes(5)), "$title · ${first.start.format(HM)}$suffix")
            } else {
                val end = entries.last().end
                if (day.atTime(end).isBefore(now)) continue
                return QuickWhen(WhenSpec(WhenMode.DEPART, add, end.plusMinutes(5)), "После пар · ${end.format(HM)}$suffix")
            }
        }
        return null
    }

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
                    if (!netLoaded) "Не удалось загрузить маршруты. Проверь интернет.\n\n$VPN_HINT"
                    else "Не удалось получить данные об автобусах."
                )
            } finally {
                refreshing = false
            }
        }
    }

    private suspend fun compute(net: Network, from: LatLng): BusState = coroutineScope {
        val now = LocalDateTime.now(TYUMEN)
        val spec = normalized(whenSpec)
        val target = if (spec.mode == WhenMode.NOW) null else target(spec)
        if (plans.isEmpty()) {
            return@coroutineScope BusState.Ready(
                emptyList(), if (spec.mode == WhenMode.NOW) boards(net, from, emptyList(), now) else emptyList(),
                now, net.near(from, Router.ACCESS_RADIUS_M).isEmpty(), spec, target,
            )
        }
        if (spec.mode == WhenMode.ARRIVE && target!!.isBefore(now.plusMinutes(5))) {
            return@coroutineScope BusState.Ready(emptyList(), emptyList(), now, false, spec, target, past = true)
        }
        transit.resetErrors()
        // Сначала параллельно берём онлайн-прогнозы для всех нужных остановок.
        val stopIds = plans.flatMap { p -> p.legs.map { it.from.id } }.distinct()
        stopIds.map { async { transit.live(it) } }.awaitAll()

        val source = transit.departureSource()
        val base = if (spec.mode == WhenMode.DEPART && target!!.isAfter(now)) target!! else now
        val journeys = plans.map { p ->
            async {
                runCatching {
                    if (spec.mode == WhenMode.ARRIVE) Router.arriveBy(p, target!!, now, source)
                    else Router.schedule(p, base, source)
                }.getOrNull()
            }
        }.awaitAll().filterNotNull()
        val ranked = Router.rank(journeys, if (spec.mode == WhenMode.ARRIVE) Router.Sort.LATEST else sort, base, take = 5)
        // «Ближайшие автобусы» имеют смысл только для «сейчас»
        val b = if (spec.mode == WhenMode.NOW) boards(net, from, ranked, now) else emptyList()
        if (ranked.isEmpty() && transit.hadNetworkErrors) {
            return@coroutineScope BusState.Error("Сервер Тюменьгортранса не отвечает.\n\n$VPN_HINT")
        }
        BusState.Ready(ranked, b, now, false, spec, target)
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
