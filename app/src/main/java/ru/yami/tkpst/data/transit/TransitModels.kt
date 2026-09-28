package ru.yami.tkpst.data.transit

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ---------- Ответы api.tgt72.ru (Тюменьгортранс) ----------

@Serializable
data class TgtList<T>(val objects: List<T> = emptyList())

@Serializable
data class TgtCheckpoint(
    val id: Int,
    val name: String = "",
    val description: String = "",
    /** [долгота, широта] */
    val coordinate: List<Double> = emptyList(),
    val routes: List<Int> = emptyList(),
)

@Serializable
data class TgtRoute(
    val id: Int,
    val name: String = "",
    val description: String = "",
    val outdated: Boolean = false,
    val dates: List<String> = emptyList(),
)

@Serializable
data class TgtRouteCheckpoint(
    @SerialName("checkpoint_id") val checkpointId: Int,
    val forward: Boolean = true,
    val order: Int = 0,
    val primary: Boolean = true,
)

@Serializable
data class TgtPredictionInfo(
    val time: String? = null,
    val precise: Boolean = true,
    @SerialName("is_plan") val isPlan: Boolean = false,
)

@Serializable
data class TgtPredictionItem(
    val prediction: TgtPredictionInfo = TgtPredictionInfo(),
    @SerialName("car_id") val carId: Int? = null,
)

@Serializable
data class TgtPrediction(
    @SerialName("route_id") val routeId: Int,
    @SerialName("checkpoint_id") val checkpointId: Int = 0,
    val order: List<TgtPredictionItem> = emptyList(),
)

@Serializable
data class TgtTimes(
    @SerialName("route_id") val routeId: Int = 0,
    @SerialName("is_forward") val isForward: Boolean = true,
    val times: List<String> = emptyList(),
)

// ---------- Компактная сеть, сохраняется на телефоне раз в день ----------

@Serializable
data class Stop(
    val id: Int,
    val name: String,
    val desc: String,
    val lat: Double,
    val lon: Double,
)

/** Одно направление одного маршрута — упорядоченный список остановок. */
@Serializable
data class Pattern(
    val routeId: Int,
    val routeName: String,
    val forward: Boolean,
    val stops: List<Int>,
)

@Serializable
data class NetworkData(
    val date: String,
    val stops: List<Stop>,
    val patterns: List<Pattern>,
)

@Serializable
data class LatLng(val lat: Double, val lon: Double)
