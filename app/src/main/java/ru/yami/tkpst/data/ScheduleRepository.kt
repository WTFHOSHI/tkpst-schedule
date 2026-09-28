package ru.yami.tkpst.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.LocalDate

/** Результат загрузки одного дня. */
data class DayData(
    val lessons: List<ApiLesson>,
    /** true — показаны сохранённые данные (нет сети). */
    val offline: Boolean,
    /** Когда данные были получены с сервера (epoch millis). */
    val savedAt: Long,
    /** Дата позже последнего опубликованного дня — расписания ещё нет. */
    val notPublished: Boolean,
)

class ScheduleRepository(context: Context) {

    companion object {
        const val BASE = "https://api.thisishyum.ru/schedule_api/tyumen"
        const val GROUP_NAME = "ИС-25-3С"
        const val COLLEGE_ID = 1
        /** Проверено вручную 28.09.2026: ИС-25-3С, кампус «Луначарского 2 курс». */
        const val FALLBACK_GROUP_ID = 196
    }

    private val prefs = context.getSharedPreferences("schedule_cache", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true }

    private fun get(path: String): String {
        val conn = URL(BASE + path).openConnection() as HttpURLConnection
        conn.connectTimeout = 10_000
        conn.readTimeout = 15_000
        conn.setRequestProperty("Accept", "application/json")
        try {
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (code !in 200..299) throw ApiException("Сервер ответил $code")
            return body
        } finally {
            conn.disconnect()
        }
    }

    private fun normalize(s: String) = s.replace(" ", "").uppercase()

    /** Группа закреплена: id ищется один раз и сохраняется. */
    private fun groupId(): Int {
        val saved = prefs.getInt("group_id", -1)
        if (saved > 0) return saved
        val id = runCatching {
            val body = get("/colleges/$COLLEGE_ID/groups")
            json.decodeFromString<List<ApiGroup>>(body)
                .firstOrNull { normalize(it.name) == normalize(GROUP_NAME) }?.studentGroupId
        }.getOrNull() ?: FALLBACK_GROUP_ID
        prefs.edit().putInt("group_id", id).apply()
        return id
    }

    private fun lastPublished(groupId: Int): LocalDate? = runCatching {
        val d = json.decodeFromString<ApiDate>(get("/groups/$groupId/schedules/last")).date
        LocalDate.parse(d.take(10))
    }.getOrNull()

    private fun parseDay(body: String): List<ApiLesson> {
        val el: JsonElement = json.parseToJsonElement(body)
        return when (el) {
            is JsonNull -> emptyList()
            is JsonArray -> el.flatMap { json.decodeFromJsonElement(ApiDay.serializer(), it).lessons }
            is JsonObject -> if (el.containsKey("lessons")) {
                json.decodeFromJsonElement(ApiDay.serializer(), el).lessons
            } else throw ApiException(el["error"]?.toString() ?: "Неизвестный ответ сервера")
            else -> emptyList()
        }
    }

    private fun cacheKey(date: LocalDate) = "day_$date"

    fun cached(date: LocalDate): DayData? {
        val body = prefs.getString(cacheKey(date), null) ?: return null
        val at = prefs.getLong(cacheKey(date) + "_at", 0L)
        return runCatching { DayData(parseDay(body), offline = true, savedAt = at, notPublished = false) }.getOrNull()
    }

    suspend fun load(date: LocalDate): DayData = withContext(Dispatchers.IO) {
        try {
            val gid = groupId()
            val body = get("/groups/$gid/schedules?date=" + URLEncoder.encode(date.toString(), "UTF-8"))
            val lessons = parseDay(body)
            val now = System.currentTimeMillis()
            var notPublished = false
            if (lessons.isEmpty()) {
                val last = lastPublished(gid)
                notPublished = last != null && date.isAfter(last)
            }
            if (!notPublished) {
                prefs.edit()
                    .putString(cacheKey(date), body)
                    .putLong(cacheKey(date) + "_at", now)
                    .apply()
            }
            DayData(lessons, offline = false, savedAt = now, notPublished = notPublished)
        } catch (e: Exception) {
            cached(date) ?: throw e
        }
    }

    /** Тихо обновляет кэш для списка дней. true — хотя бы один день скачан с сервера. */
    suspend fun prefetch(dates: List<LocalDate>): Boolean {
        var any = false
        for (d in dates) {
            runCatching { load(d) }.onSuccess { if (!it.offline) any = true }
        }
        return any
    }

    fun clearCache() {
        val keep = prefs.getInt("group_id", -1)
        prefs.edit().clear().apply()
        if (keep > 0) prefs.edit().putInt("group_id", keep).apply()
    }
}

class ApiException(message: String) : Exception(message)
