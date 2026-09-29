package ru.yami.tkpst.data.transit

import java.time.Duration
import java.time.LocalDateTime
import kotlin.math.max

/** Сеть маршрутов с предрасчётами для быстрого поиска. */
class Network(val data: NetworkData) {
    val stops: Map<Int, Stop> = data.stops.associateBy { it.id }
    val patterns: List<Pattern> = data.patterns.filter { p -> p.stops.size >= 2 && p.stops.all { it in stops } }

    /** Накопленное время поездки (мин) от начала направления до каждой остановки. */
    val cum: List<DoubleArray> = patterns.map { p ->
        val arr = DoubleArray(p.stops.size)
        for (i in 1 until p.stops.size) {
            val d = Geo.distanceM(stops.getValue(p.stops[i - 1]), stops.getValue(p.stops[i]))
            arr[i] = arr[i - 1] + d * RIDE_DETOUR / BUS_M_PER_MIN + DWELL_MIN
        }
        arr
    }

    /** Остановка → список (индекс направления, позиция в нём). */
    val byStop: Map<Int, List<IntArray>> = buildMap<Int, MutableList<IntArray>> {
        patterns.forEachIndexed { pi, p ->
            p.stops.forEachIndexed { pos, s -> getOrPut(s) { mutableListOf() }.add(intArrayOf(pi, pos)) }
        }
    }

    private val neighborCache = HashMap<Int, List<kotlin.Pair<Stop, Double>>>()

    fun near(p: LatLng, radiusM: Double): List<kotlin.Pair<Stop, Double>> =
        stops.values.asSequence()
            .filter { it.id in byStop }
            .map { it to Geo.distanceM(p, it) }
            .filter { it.second <= radiusM }
            .sortedBy { it.second }
            .toList()

    fun neighbors(stopId: Int, radiusM: Double): List<kotlin.Pair<Stop, Double>> =
        neighborCache.getOrPut(stopId) {
            val s = stops.getValue(stopId)
            stops.values.asSequence()
                .filter { it.id in byStop }
                .map { it to Geo.distanceM(s, it) }
                .filter { it.second <= radiusM }
                .toList()
        }

    companion object {
        /** Средняя скорость автобуса в городе ~21 км/ч между остановками + ~30 с на остановке. */
        const val BUS_M_PER_MIN = 350.0
        const val RIDE_DETOUR = 1.15
        const val DWELL_MIN = 0.5
    }
}

data class Walk(val meters: Int, val minutes: Double)

data class RideLeg(
    val patternIndex: Int,
    val routeId: Int,
    val routeName: String,
    val forward: Boolean,
    val from: Stop,
    val to: Stop,
    val stopsCount: Int,
    val rideMin: Double,
)

/** Вариант поездки без привязки ко времени. */
data class Plan(
    val walkStart: Walk,
    val legs: List<RideLeg>,
    val transferWalk: Walk?,
    val walkEnd: Walk,
    /** Оценка для первичной сортировки (без ожидания первого автобуса). */
    val staticMin: Double,
) {
    val key: String get() = legs.joinToString(">") { it.routeId.toString() + if (it.forward) "f" else "b" }
}

object Router {
    const val ACCESS_RADIUS_M = 1000.0
    const val TRANSFER_RADIUS_M = 500.0
    /** Условное ожидание на пересадке для первичной сортировки. */
    const val TRANSFER_PENALTY_MIN = 6.0

    private fun walk(straightM: Double) = Walk(Geo.walkM(straightM).toInt(), Geo.walkMin(straightM))

    /**
     * Ищет варианты: прямые и с одной пересадкой (пешком до 500 м).
     * Возвращает лучшие по оценочному времени, по одному на каждую комбинацию маршрутов.
     */
    fun findPlans(
        net: Network,
        origin: LatLng,
        dest: LatLng,
        limit: Int = 30,
        accessRadiusM: Double = ACCESS_RADIUS_M,
        transferRadiusM: Double = TRANSFER_RADIUS_M,
    ): List<Plan> {
        val nearO = net.near(origin, accessRadiusM)
        val nearD = net.near(dest, accessRadiusM)
        if (nearO.isEmpty() || nearD.isEmpty()) return emptyList()
        val walkO = nearO.associate { it.first.id to Geo.walkMin(it.second) }
        val distO = nearO.associate { it.first.id to it.second }
        val walkD = nearD.associate { it.first.id to Geo.walkMin(it.second) }
        val distD = nearD.associate { it.first.id to it.second }

        // Для каждого направления: лучший выход к цели после позиции i.
        // best[i] = min_{j>i} (cum[j] + walkD[j]), bestAt[i] = j
        val egress = net.patterns.mapIndexed { pi, p ->
            val c = net.cum[pi]
            val n = p.stops.size
            val best = DoubleArray(n) { Double.POSITIVE_INFINITY }
            val bestAt = IntArray(n) { -1 }
            var curBest = Double.POSITIVE_INFINITY
            var curAt = -1
            for (i in n - 1 downTo 0) {
                best[i] = curBest
                bestAt[i] = curAt
                val w = walkD[p.stops[i]]
                if (w != null && c[i] + w < curBest) {
                    curBest = c[i] + w
                    curAt = i
                }
            }
            best to bestAt
        }

        val results = HashMap<String, Plan>()
        fun offer(plan: Plan) {
            val old = results[plan.key]
            if (old == null || plan.staticMin < old.staticMin) results[plan.key] = plan
        }

        fun rideLeg(pi: Int, from: Int, to: Int): RideLeg {
            val p = net.patterns[pi]
            return RideLeg(
                pi, p.routeId, p.routeName, p.forward,
                net.stops.getValue(p.stops[from]), net.stops.getValue(p.stops[to]),
                to - from, net.cum[pi][to] - net.cum[pi][from],
            )
        }

        // --- Прямые ---
        var bestDirect = Double.POSITIVE_INFINITY
        for ((b, _) in nearO) {
            val wO = walkO.getValue(b.id)
            for (pp in net.byStop[b.id].orEmpty()) {
                val (pi, i) = pp[0] to pp[1]
                val (best, bestAt) = egress[pi]
                if (best[i].isInfinite()) continue
                val j = bestAt[i]
                val total = wO + best[i] - net.cum[pi][i]
                bestDirect = minOf(bestDirect, total)
                val aId = net.patterns[pi].stops[j]
                offer(
                    Plan(
                        walk(distO.getValue(b.id)), listOf(rideLeg(pi, i, j)), null,
                        walk(distD.getValue(aId)), total,
                    )
                )
            }
        }

        // --- С одной пересадкой ---
        // Отсекаем явно долгие варианты, чтобы не перебирать весь город.
        val bound = if (bestDirect.isFinite()) bestDirect + 20 else 150.0
        val transferBest = HashMap<Long, Plan>()
        fun code(p: Pattern) = p.routeId.toLong() * 2 + if (p.forward) 1 else 0
        for ((b, _) in nearO) {
            val wO = walkO.getValue(b.id)
            for (pp in net.byStop[b.id].orEmpty()) {
                val pi1 = pp[0]
                val i = pp[1]
                val p1 = net.patterns[pi1]
                val c1 = net.cum[pi1]
                val code1 = code(p1) shl 32
                for (k in i + 1 until p1.stops.size) {
                    val t1 = wO + c1[k] - c1[i]
                    if (t1 > bound) break
                    val xId = p1.stops[k]
                    if (xId in walkD) continue // отсюда уже можно дойти пешком — это прямой вариант
                    for ((y, dxy) in net.neighbors(xId, transferRadiusM)) {
                        val tw = Geo.walkMin(dxy)
                        for (qq in net.byStop[y.id].orEmpty()) {
                            val pi2 = qq[0]
                            val m = qq[1]
                            val p2 = net.patterns[pi2]
                            if (p2.routeId == p1.routeId) continue
                            val (best2, bestAt2) = egress[pi2]
                            if (best2[m].isInfinite()) continue
                            val total = t1 + tw + TRANSFER_PENALTY_MIN + best2[m] - net.cum[pi2][m]
                            if (total > bound + TRANSFER_PENALTY_MIN) continue
                            val key = code1 or code(p2)
                            val old = transferBest[key]
                            if (old != null && old.staticMin <= total) continue
                            val j = bestAt2[m]
                            transferBest[key] = Plan(
                                walk(distO.getValue(b.id)),
                                listOf(rideLeg(pi1, i, k), rideLeg(pi2, m, j)),
                                walk(dxy),
                                walk(distD.getValue(p2.stops[j])),
                                total,
                            )
                        }
                    }
                }
            }
        }
        transferBest.values.forEach(::offer)

        // Прямые всегда в выборке, пересадочные — только если не хуже лучшего прямого на 20 мин.
        return results.values
            .filter { it.legs.size == 1 || it.staticMin <= bound + TRANSFER_PENALTY_MIN }
            .sortedBy { it.staticMin }
            .take(limit)
    }

    // ---------------- Привязка ко времени ----------------

    /** saved — время взято из сохранённого на телефоне графика (сервер не ответил). */
    data class Departure(val time: LocalDateTime, val live: Boolean, val saved: Boolean = false)

    /** Источник времени прибытия автобусов на остановку. */
    interface DepartureSource {
        /** Первый автобус маршрута [routeId] на остановке [stopId] не раньше [after]. */
        suspend fun next(stopId: Int, routeId: Int, forward: Boolean, after: LocalDateTime): Departure?
    }

    data class TimedLeg(val leg: RideLeg, val board: LocalDateTime, val live: Boolean, val alight: LocalDateTime, val saved: Boolean = false)

    data class Journey(
        val plan: Plan,
        /** Когда выходить из дома / колледжа. */
        val leaveAt: LocalDateTime,
        val legs: List<TimedLeg>,
        val arrive: LocalDateTime,
        /** Другие номера, которые идут тем же путём на последнем участке («или №14, 54»). */
        val alternatives: List<String> = emptyList(),
    ) {
        val durationMin: Long get() = Duration.between(leaveAt, arrive).toMinutes()

        /** Варианты с одинаковой «формой» пути отличаются только номером на последнем участке. */
        val groupKey: String
            get() = if (legs.size == 1) {
                "D:${legs[0].leg.from.id}>${legs[0].leg.to.id}"
            } else {
                "T:${legs[0].leg.routeName}:${legs[0].leg.from.id}>${legs[0].leg.to.id}>${legs[1].leg.from.id}>${legs[1].leg.to.id}"
            }
    }

    private fun plusMin(t: LocalDateTime, min: Double) = t.plusSeconds((min * 60).toLong())

    suspend fun schedule(plan: Plan, now: LocalDateTime, source: DepartureSource): Journey? {
        var t = plusMin(now, plan.walkStart.minutes)
        val timed = mutableListOf<TimedLeg>()
        plan.legs.forEachIndexed { idx, leg ->
            if (idx > 0) t = plusMin(t, plan.transferWalk?.minutes ?: 0.0)
            val dep = source.next(leg.from.id, leg.routeId, leg.forward, t) ?: return null
            val alight = plusMin(dep.time, leg.rideMin)
            timed += TimedLeg(leg, dep.time, dep.live, alight, dep.saved)
            t = alight
        }
        val arrive = plusMin(t, plan.walkEnd.minutes)
        // Выйти так, чтобы прийти на остановку за минуту до автобуса.
        val leave = plusMin(timed.first().board, -(plan.walkStart.minutes + 1.0))
        return Journey(plan, maxOf(leave, now), timed, arrive)
    }

    /**
     * «Приехать к»: самый поздний выезд, при котором успеваешь к [deadline].
     * [earliest] — раньше этого выйти нельзя (обычно «сейчас»).
     */
    suspend fun arriveBy(plan: Plan, deadline: LocalDateTime, earliest: LocalDateTime, source: DepartureSource): Journey? {
        var start = maxOf(earliest, plusMin(deadline, -(plan.staticMin + 20)))
        var j = schedule(plan, start, source)
        // Не успеваем — выезжаем раньше.
        var i = 0
        while (i < 8 && j != null && j.arrive.isAfter(deadline)) {
            val late = Duration.between(deadline, j.arrive)
            val next = start.minus(late).minusMinutes(2)
            if (next.isBefore(earliest)) {
                if (start == earliest) return null
                start = earliest
            } else start = next
            j = schedule(plan, start, source)
            i++
        }
        if (j == null || j.arrive.isAfter(deadline)) return null
        // Успеваем — пробуем следующий автобус, чтобы не выходить слишком рано.
        repeat(12) {
            val later = plusMin(j!!.legs.first().board, -plan.walkStart.minutes + 1.0)
            val j2 = schedule(plan, later, source)
            if (j2 == null || j2.arrive.isAfter(deadline) || !j2.legs.first().board.isAfter(j!!.legs.first().board)) return j
            j = j2
        }
        return j
    }

    /** DURATION — меньше в пути, ARRIVAL — раньше приеду, LATEST — «приехать к»: выйти как можно позже. */
    enum class Sort { DURATION, ARRIVAL, LATEST }

    private fun ordered(list: List<Journey>, sort: Sort): List<Journey> = when (sort) {
        Sort.DURATION -> list.sortedWith(compareBy<Journey> { it.durationMin }.thenBy { it.arrive })
        Sort.ARRIVAL -> list.sortedWith(compareBy<Journey> { it.arrive }.thenBy { it.durationMin })
        Sort.LATEST -> list.sortedWith(compareByDescending<Journey> { it.leaveAt }.thenBy { it.durationMin })
    }

    /** Лучшие варианты; [now] — момент, от которого считаются «ближайшие». */
    fun rank(journeys: List<Journey>, sort: Sort, now: LocalDateTime, take: Int = 5): List<Journey> {
        // Не предлагаем автобусы, до которых больше часа — это уже не «ближайший» вариант.
        val soon = if (sort == Sort.LATEST) journeys
        else journeys.filter { Duration.between(now, it.leaveAt).toMinutes() <= 60 }.ifEmpty { journeys }
        // Склеиваем одинаковые пути с разными номерами: показываем лучший, остальные — «или №…».
        val grouped = ordered(soon, sort).groupBy { it.groupKey }.values.map { group ->
            val best = group.first()
            val others = group.drop(1).map { it.legs.last().leg.routeName }
                .filter { it != best.legs.last().leg.routeName }
                .distinct()
            best.copy(alternatives = others)
        }
        // Один вариант на комбинацию номеров (у одного номера бывают разные id направлений).
        return ordered(grouped, sort).distinctBy { j -> j.legs.joinToString(">") { it.leg.routeName } }.take(max(1, take))
    }
}
