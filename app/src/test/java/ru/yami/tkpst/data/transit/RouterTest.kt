package ru.yami.tkpst.data.transit

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime

class RouterTest {

    // Остановки вдоль «улицы» с запада на восток, ~560 м между соседними (0.01° долготы на 57° ш.)
    private fun stop(id: Int, lon: Double, lat: Double = 57.15) = Stop(id, "S$id", "", lat, lon)

    private val home = LatLng(57.15, 65.40)
    private val college = LatLng(57.15, 65.50)

    // 1..11 — линия A (прямой, но медленный крюк через север)
    // 20..25 — линия B с запада до середины, 30..35 — линия C от середины до колледжа
    private val stops = buildList {
        add(stop(1, 65.401))
        // крюк на север
        for (i in 2..10) add(stop(i, 65.40 + i * 0.01, lat = 57.15 + 0.03))
        add(stop(11, 65.499))
        for (i in 20..25) add(stop(i, 65.402 + (i - 20) * 0.01))
        for (i in 30..35) add(stop(i, 65.452 + (i - 30) * 0.0095))
    }

    private val net = Network(
        NetworkData(
            "2026-09-29", stops,
            listOf(
                Pattern(1, "A", true, (1..11).toList()),
                Pattern(1, "A", false, (11 downTo 1).toList()),
                Pattern(2, "B", true, (20..25).toList()),
                Pattern(3, "C", true, (30..35).toList()),
                Pattern(4, "D", true, (30..35).toList()),
            ),
        )
    )

    @Test
    fun findsDirectAndTransfer() {
        val plans = Router.findPlans(net, home, college)
        assertTrue(plans.any { it.legs.size == 1 && it.legs[0].routeName == "A" && it.legs[0].forward })
        assertTrue(plans.any { it.legs.size == 2 && it.legs[0].routeName == "B" && it.legs[1].routeName == "C" })
        // Обратное направление A к колледжу не ведёт
        assertTrue(plans.none { it.legs.any { l -> l.routeName == "A" && !l.forward } })
    }

    @Test
    fun transferIsShorterThanDetour() {
        val plans = Router.findPlans(net, home, college)
        val direct = plans.first { it.legs.size == 1 }
        val transfer = plans.first { it.legs.size == 2 }
        assertTrue("пересадка должна быть быстрее крюка", transfer.staticMin < direct.staticMin)
    }

    @Test
    fun schedulingUsesDeparturesAndGroupsAlternatives() = runBlocking {
        val now = LocalDateTime.of(2026, 9, 29, 7, 0)
        val source = object : Router.DepartureSource {
            override suspend fun next(stopId: Int, routeId: Int, forward: Boolean, after: LocalDateTime): Router.Departure? {
                // Каждый маршрут ходит раз в 10 минут, C опаздывает на 5 минут относительно D
                val offset = if (routeId == 3) 5L else 0L
                var t = now.plusMinutes(offset)
                while (t.isBefore(after)) t = t.plusMinutes(10)
                return Router.Departure(t, live = routeId != 2)
            }
        }
        val plans = Router.findPlans(net, home, college)
        val journeys = plans.mapNotNull { Router.schedule(it, now, source) }
        journeys.forEach { j ->
            assertTrue(!j.leaveAt.isBefore(now))
            assertTrue(j.arrive.isAfter(j.legs.last().alight) || j.arrive == j.legs.last().alight)
            for (i in 1 until j.legs.size) assertTrue(!j.legs[i].board.isBefore(j.legs[i - 1].alight))
        }
        val ranked = Router.rank(journeys, Router.Sort.DURATION, now)
        assertTrue(ranked.isNotEmpty())
        // Сортировка по времени в пути
        assertEquals(ranked.map { it.durationMin }, ranked.map { it.durationMin }.sorted())
        // C и D идут одинаково от пересадки — склеены в один вариант с альтернативой
        val t = ranked.first { it.legs.size == 2 }
        assertTrue(t.alternatives.isNotEmpty())
    }

    @Test
    fun noStopsNearby() {
        assertTrue(Router.findPlans(net, LatLng(56.0, 60.0), college).isEmpty())
    }

    @Test
    fun arriveByPicksLatestDeparture() = runBlocking {
        val earliest = LocalDateTime.of(2026, 9, 29, 22, 0)
        val day = LocalDateTime.of(2026, 9, 30, 6, 0)
        val source = object : Router.DepartureSource {
            override suspend fun next(stopId: Int, routeId: Int, forward: Boolean, after: LocalDateTime): Router.Departure? {
                var t = day.plusMinutes(if (routeId == 3) 5L else 0L)
                while (t.isBefore(after)) t = t.plusMinutes(10)
                return Router.Departure(t, live = false)
            }
        }
        val deadline = LocalDateTime.of(2026, 9, 30, 8, 10)
        val js = Router.findPlans(net, home, college).mapNotNull { Router.arriveBy(it, deadline, earliest, source) }
        assertTrue(js.isNotEmpty())
        js.forEach { j ->
            assertTrue("успеваем", !j.arrive.isAfter(deadline))
            assertTrue("не слишком рано", j.arrive.isAfter(deadline.minusMinutes(11)))
        }
        val r = Router.rank(js, Router.Sort.LATEST, earliest)
        assertEquals(r.map { it.leaveAt }, r.map { it.leaveAt }.sortedDescending())
    }
}
