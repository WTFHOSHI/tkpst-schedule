package ru.yami.tkpst.data.transit

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

object Geo {
    /** Колледж, ул. Луначарского, 19 (координаты из OpenStreetMap). */
    val COLLEGE = LatLng(57.1647166, 65.5103316)
    const val COLLEGE_LABEL = "Колледж, Луначарского, 19"

    /** Скорость пешком ~4.5 км/ч, с поправкой на то, что по прямой не ходят. */
    private const val WALK_M_PER_MIN = 75.0
    private const val DETOUR = 1.25

    fun distanceM(aLat: Double, aLon: Double, bLat: Double, bLon: Double): Double {
        val r = 6_371_000.0
        val dLat = Math.toRadians(bLat - aLat)
        val dLon = Math.toRadians(bLon - aLon)
        val h = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(aLat)) * cos(Math.toRadians(bLat)) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * r * atan2(sqrt(h), sqrt(1 - h))
    }

    fun distanceM(a: LatLng, b: Stop) = distanceM(a.lat, a.lon, b.lat, b.lon)
    fun distanceM(a: Stop, b: Stop) = distanceM(a.lat, a.lon, b.lat, b.lon)

    /** Пешая дистанция по улицам (оценка) в метрах. */
    fun walkM(straightM: Double) = straightM * DETOUR

    fun walkMin(straightM: Double) = walkM(straightM) / WALK_M_PER_MIN
}
