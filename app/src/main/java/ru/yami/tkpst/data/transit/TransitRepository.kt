package ru.yami.tkpst.data.transit

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import ru.yami.tkpst.data.Http
import ru.yami.tkpst.data.TYUMEN
import java.io.File
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.concurrent.ConcurrentHashMap

/** Данные Тюменьгортранса: сеть маршрутов (кэш на день), онлайн-прогнозы, расписание по графику. */
class TransitRepository(context: Context) {

    companion object {
        const val BASE = "https://api.tgt72.ru/api/v5"
        private const val PREDICTION_TTL_MS = 20_000L
        private val YMD: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyyMMdd")
    }

    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true }

    /** Были ли сетевые ошибки при последнем обновлении (сервер недоступен, например из-за VPN). */
    @Volatile var hadNetworkErrors = false
        private set
    fun resetErrors() { hadNetworkErrors = false }
    private val file = File(context.filesDir, "network.json")
    private val netMutex = Mutex()
    @Volatile private var network: Network? = null

    // ---------------- Сеть маршрутов ----------------

    /** Сеть на сегодня: из памяти, из файла или скачивается (~130 запросов, раз в день). */
    suspend fun network(onProgress: (done: Int, total: Int) -> Unit = { _, _ -> }): Network {
        netMutex.withLock {
            val today = LocalDate.now(TYUMEN).toString()
            network?.takeIf { it.data.date == today }?.let { return it }
            val fromFile = withContext(Dispatchers.IO) {
                runCatching { json.decodeFromString<NetworkData>(file.readText()) }.getOrNull()
            }
            if (fromFile != null && fromFile.date == today) {
                return Network(fromFile).also { network = it }
            }
            val fresh = runCatching { download(onProgress) }
            fresh.getOrNull()?.let { data ->
                withContext(Dispatchers.IO) {
                    // Перезаписываем один и тот же файл — размер не растёт.
                    val tmp = File(file.parentFile, "network.tmp")
                    tmp.writeText(json.encodeToString(NetworkData.serializer(), data))
                    tmp.renameTo(file)
                }
                return Network(data).also { network = it }
            }
            // Нет сети — работаем на вчерашних данных, если есть.
            if (fromFile != null) return Network(fromFile).also { network = it }
            throw fresh.exceptionOrNull() ?: IllegalStateException("Не удалось загрузить маршруты")
        }
    }

    private suspend fun download(onProgress: (Int, Int) -> Unit): NetworkData = withContext(Dispatchers.IO) {
        val today = LocalDate.now(TYUMEN)
        val routes = json.decodeFromString<TgtList<TgtRoute>>(Http.get("$BASE/routesforsearch/", 30_000)).objects
            .filter { !it.outdated && (it.dates.isEmpty() || today.toString() in it.dates) }
        val checkpoints = json.decodeFromString<TgtList<TgtCheckpoint>>(
            Http.get("$BASE/checkpointsforsearch/", 60_000)
        ).objects.filter { it.coordinate.size >= 2 }
        val byId = checkpoints.associateBy { it.id }

        val sem = Semaphore(8)
        var done = 0
        onProgress(0, routes.size)
        val patterns = coroutineScope {
            routes.map { r ->
                async {
                    sem.withPermit {
                        val list = runCatching {
                            json.decodeFromString<TgtList<TgtRouteCheckpoint>>(
                                Http.get("$BASE/routecheckpoint/?route_id=${r.id}&date=${today.format(YMD)}")
                            ).objects
                        }.getOrDefault(emptyList())
                        synchronized(this@TransitRepository) { done++; onProgress(done, routes.size) }
                        list.groupBy { it.forward }.mapNotNull { (fwd, items) ->
                            val main = items.filter { it.primary }.ifEmpty { items }
                            val ordered = main.sortedBy { it.order }.map { it.checkpointId }
                                .filter { it in byId }
                                .fold(mutableListOf<Int>()) { acc, id -> if (acc.lastOrNull() != id) acc.add(id); acc }
                            if (ordered.size < 2) null else Pattern(r.id, r.name, fwd, ordered)
                        }
                    }
                }
            }.awaitAll().flatten()
        }
        if (patterns.isEmpty()) throw IllegalStateException("Сервер не вернул маршруты")
        val used = patterns.flatMapTo(HashSet()) { it.stops }
        val stops = used.mapNotNull { byId[it] }.map {
            Stop(it.id, it.name.trim(), it.description.trim(), lat = it.coordinate[1], lon = it.coordinate[0])
        }
        NetworkData(today.toString(), stops, patterns)
    }

    // ---------------- Онлайн-прогнозы ----------------

    data class LiveArrival(val routeId: Int, val time: LocalDateTime, val precise: Boolean)

    private data class Cached(val at: Long, val items: List<LiveArrival>)
    private val predictions = ConcurrentHashMap<Int, Cached>()

    private fun toDateTime(t: String, now: LocalDateTime): LocalDateTime? {
        val lt = runCatching { LocalTime.parse(t) }.getOrNull() ?: return null
        var dt = now.toLocalDate().atTime(lt)
        // Прогноз на «00:10», когда сейчас 23:50, — это уже завтра.
        if (dt.isBefore(now.minusHours(3))) dt = dt.plusDays(1)
        return dt
    }

    /**
     * Все запросы к Тюменьгортрансу за прогнозами и графиком идут не больше 6 одновременно,
     * а одинаковые запросы не дублируются — иначе сервер начинает тормозить и отбивать запросы.
     */
    private val requestLimit = Semaphore(6)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private suspend fun limitedGet(url: String): String =
        requestLimit.withPermit { Http.get(url, timeoutMs = 10_000, connectMs = 8_000) }

    private val liveInFlight = ConcurrentHashMap<Int, Deferred<List<LiveArrival>?>>()

    /** Все ближайшие автобусы на остановке по данным GPS. Кэш 20 секунд. */
    suspend fun live(stopId: Int, force: Boolean = false): List<LiveArrival> {
        val c = predictions[stopId]
        if (!force && c != null && System.currentTimeMillis() - c.at < PREDICTION_TTL_MS) return c.items
        // LAZY + start(): запрос стартует только после того, как попал в карту — без гонок.
        val d = liveInFlight.getOrPut(stopId) {
            scope.async(start = CoroutineStart.LAZY) {
                run {
                    val now = LocalDateTime.now(TYUMEN)
                    runCatching {
                        json.decodeFromString<TgtList<TgtPrediction>>(limitedGet("$BASE/prediction/?checkpoint_id=$stopId")).objects
                            .flatMap { p ->
                                p.order.mapNotNull { o ->
                                    val t = o.prediction.time ?: return@mapNotNull null
                                    toDateTime(t, now)?.let { LiveArrival(p.routeId, it, o.prediction.precise) }
                                }
                            }
                            .filter { !it.time.isBefore(now.minusMinutes(1)) }
                            .sortedBy { it.time }
                    }.getOrNull()
                }
            }
        }
        d.start()
        val items = try { d.await() } finally { liveInFlight.remove(stopId, d) }
        if (items == null) hadNetworkErrors = true
        val result = items ?: c?.items ?: emptyList()
        predictions[stopId] = Cached(System.currentTimeMillis(), result)
        return result
    }

    /** Сбросить кэш прогнозов (кнопка «обновить» и таймер 30 с). */
    fun invalidateLive() = predictions.clear()

    // ---------------- Расписание по графику ----------------

    /**
     * График остановки на день — ОДНИМ запросом сразу для всех номеров (как на сайте tgt72.ru).
     * null — не удалось загрузить; такие неудачи не повторяем минуту.
     */
    private data class StopDay(val at: Long, val byRoute: Map<Int, List<TgtTimes>>?)
    private val stopDays = ConcurrentHashMap<String, Deferred<StopDay>>()

    private suspend fun stopDay(stopId: Int, date: LocalDate): Map<Int, List<TgtTimes>>? {
        val key = "$stopId/$date"
        val existing = stopDays[key]
        if (existing != null && existing.isCompleted) {
            val v = existing.await()
            if (v.byRoute == null && System.currentTimeMillis() - v.at > 60_000) stopDays.remove(key, existing)
        }
        val d = stopDays.getOrPut(key) {
            scope.async {
                val map = runCatching {
                    json.decodeFromString<TgtList<TgtTimes>>(
                        limitedGet("$BASE/times/?checkpoint_id=$stopId&date=${date.format(YMD)}")
                    ).objects.groupBy { it.routeId }
                }.getOrNull()
                StopDay(System.currentTimeMillis(), map)
            }
        }
        return d.await().byRoute
    }

    private val planned = ConcurrentHashMap<String, List<LocalDateTime>>()
    private val routeFallbackFailedAt = ConcurrentHashMap<String, Long>()

    /** Время по графику для маршрута на остановке (кэш на день). */
    suspend fun planned(stopId: Int, routeId: Int, forward: Boolean, date: LocalDate): List<LocalDateTime> {
        val key = "$stopId/$routeId/$forward/$date"
        planned[key]?.let { return it }
        val day = stopDay(stopId, date)
        if (day == null) { hadNetworkErrors = true; return emptyList() }
        var objs = day[routeId].orEmpty()
        if (objs.isEmpty()) {
            // В общем графике остановки этого номера нет — запасной запрос именно по маршруту.
            val failed = routeFallbackFailedAt[key]
            if (failed == null || System.currentTimeMillis() - failed > 60_000) {
                objs = runCatching {
                    json.decodeFromString<TgtList<TgtTimes>>(
                        limitedGet("$BASE/times/?checkpoint_id=$stopId&route_id=$routeId&date=${date.format(YMD)}")
                    ).objects
                }.getOrElse { routeFallbackFailedAt[key] = System.currentTimeMillis(); hadNetworkErrors = true; emptyList() }
            }
        }
        val matching = objs.filter { it.isForward == forward }.ifEmpty { objs }
        val list = matching.flatMap { it.times }
            .mapNotNull { runCatching { date.atTime(LocalTime.parse(it)) }.getOrNull() }
            .sorted()
        planned[key] = list
        return list
    }

    /**
     * Источник отправлений для роутера: сначала онлайн-прогноз,
     * если его нет или он не достаёт до нужного времени — расписание по графику.
     */
    fun departureSource(): Router.DepartureSource = object : Router.DepartureSource {
        override suspend fun next(stopId: Int, routeId: Int, forward: Boolean, after: LocalDateTime): Router.Departure? {
            val liveTimes = live(stopId).filter { it.routeId == routeId }
            liveTimes.firstOrNull { !it.time.isBefore(after) }?.let { return Router.Departure(it.time, true) }
            val lastLive = liveTimes.lastOrNull()?.time
            val date = after.toLocalDate()
            fun pick(list: List<LocalDateTime>) =
                list.firstOrNull { !it.isBefore(after) && (lastLive == null || it.isAfter(lastLive.plusMinutes(2))) }
            return (pick(planned(stopId, routeId, forward, date)) ?: pick(planned(stopId, routeId, forward, date.plusDays(1))))
                ?.let { Router.Departure(it, false) }
        }
    }
}
