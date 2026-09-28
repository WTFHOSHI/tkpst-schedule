package ru.yami.tkpst.data.transit

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import ru.yami.tkpst.data.Http
import java.net.URLEncoder

/** Поиск адресов через OpenStreetMap (Nominatim), только в пределах Тюмени. */
object Geocoder {
    private const val BASE = "https://nominatim.openstreetmap.org"
    /** Границы Тюмени с окрестностями: запад, север, восток, юг. */
    private const val VIEWBOX = "65.25,57.28,65.80,57.02"

    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true }

    @Serializable
    private data class NAddress(
        val road: String? = null,
        @SerialName("house_number") val houseNumber: String? = null,
        val suburb: String? = null,
        @SerialName("city_district") val cityDistrict: String? = null,
        val neighbourhood: String? = null,
        val city: String? = null,
        val town: String? = null,
        val village: String? = null,
    )

    @Serializable
    private data class NPlace(
        val lat: String,
        val lon: String,
        val name: String? = null,
        @SerialName("display_name") val displayName: String = "",
        val address: NAddress? = null,
    )

    data class Place(val title: String, val subtitle: String, val point: LatLng)

    private fun NPlace.toPlace(): Place {
        val a = address
        val street = listOfNotNull(a?.road, a?.houseNumber).joinToString(", ")
        val title = when {
            street.isNotBlank() -> street
            !name.isNullOrBlank() -> name
            else -> displayName.substringBefore(",")
        }
        val sub = listOfNotNull(
            a?.suburb ?: a?.neighbourhood ?: a?.cityDistrict,
            a?.city ?: a?.town ?: a?.village,
        ).distinct().joinToString(", ")
        return Place(title, sub, LatLng(lat.toDouble(), lon.toDouble()))
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    suspend fun search(query: String): List<Place> = withContext(Dispatchers.IO) {
        val q = query.trim()
        if (q.length < 3) return@withContext emptyList()
        val full = if (q.contains("тюмен", ignoreCase = true)) q else "$q, Тюмень"
        val url = "$BASE/search?format=jsonv2&addressdetails=1&limit=6&accept-language=ru" +
            "&countrycodes=ru&viewbox=$VIEWBOX&bounded=1&q=${enc(full)}"
        json.decodeFromString<List<NPlace>>(Http.get(url)).map { it.toPlace() }
            .distinctBy { it.title + it.subtitle }
    }

    suspend fun reverse(point: LatLng): Place? = withContext(Dispatchers.IO) {
        val url = "$BASE/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=ru" +
            "&lat=${point.lat}&lon=${point.lon}"
        runCatching { json.decodeFromString<NPlace>(Http.get(url)).toPlace().copy(point = point) }.getOrNull()
    }
}
