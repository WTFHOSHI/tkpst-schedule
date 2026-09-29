package ru.yami.tkpst.data.transit

import android.content.Context
import kotlinx.coroutines.Dispatchers
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

    /** Все ближайшие автобусы на остановке по данным GPS. Кэш 20 секунд. */
    suspend fun live(stopId: Int, force: Boolean = false): List<LiveArrival> = withContext(Dispatchers.IO) {
        val c = predictions[stopId]
        if (!force && c != null && System.currentTimeMillis() - c.at < PREDICTION_TTL_MS) return@withContext c.items
        val now = LocalDateTime.now(TYUMEN)
        val items = runCatching {
            json.decodeFromString<TgtList<TgtPrediction>>(Http.get("$BASE/prediction/?checkpoint_id=$stopId", timeoutMs = 8_000, connectMs = 6_000)).objects
                .flatMap { p ->
                    p.order.mapNotNull { o ->
                        val t = o.prediction.time ?: return@mapNotNull null
                        toDateTime(t, now)?.let { LiveArrival(p.routeId, it, o.prediction.precise) }
                    }
                }
                .filter { !it.time.isBefore(now.minusMinutes(1)) }
                .sortedBy { it.time }
        }.getOrElse { hadNetworkErrors = true; c?.items ?: emptyList() }
        predictions[stopId] = Cached(System.currentTimeMillis(), items)
        items
    }

    /** Сбросить кэш прогнозов (кнопка «обновить» и таймер 30 с). */
    fun invalidateLive() = predictions.clear()

    // ---------------- Расписание по графику ----------------

    private val planned = ConcurrentHashMap<String, List<LocalDateTime>>()
    /** Неудачные запросы не повторяем минуту — иначе «Приехать к» ждёт таймауты по кругу. */
    private val plannedFailedAt = ConcurrentHashMap<String, Long>()

    /** Время по графику для маршрута на остановке (кэш на день). */
    suspend fun planned(stopId: Int, routeId: Int, forward: Boolean, date: LocalDate): List<LocalDateTime> =
        withContext(Dispatchers.IO) {
            val key = "$stopId/$routeId/$forward/$date"
            planned[key]?.let { return@withContext it }
            plannedFailedAt[key]?.let { if (System.currentTimeMillis() - it < 60_000) { hadNetworkErrors = true; return@withContext emptyList() } }
            val list = runCatching {
                val objs = json.decodeFromString<TgtList<TgtTimes>>(
                    Http.get("$BASE/times/?checkpoint_id=$stopId&route_id=$routeId&date=${date.format(YMD)}", timeoutMs = 8_000, connectMs = 6_000)
                ).objects
                val matching = objs.filter { it.isForward == forward }.ifEmpty { objs }
                matching.flatMap { it.times }
                    .mapNotNull { runCatching { date.atTime(LocalTime.parse(it)) }.getOrNull() }
                    .sorted()
            }.getOrElse {
                hadNetworkErrors = true
                plannedFailedAt[key] = System.currentTimeMillis()
                null
            } ?: return@withContext emptyList()
            planned[key] = list
            list
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
