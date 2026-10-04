package ru.yami.tkpst.data

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.time.LocalDate

/**
 * Изменения из админ-панели (web/overrides.json на сайте).
 * Приложение скачивает файл само — обновлять APK не нужно.
 */
@Serializable
data class OverridePair(
    val number: Int = 0,
    /** "remote" — дистант, "cancelled" — отменена, иначе как есть. */
    val status: String? = null,
    val title: String? = null,
    val cabinet: String? = null,
    val teacher: String? = null,
)

/** Время пары из админки: «08:30»–«10:00». */
@Serializable
data class BellTime(
    val number: Int = 0,
    val start: String? = null,
    val end: String? = null,
)

@Serializable
data class BellRange(
    val start: String? = null,
    val end: String? = null,
)

/** Общее «Расписание звонков» из админки — заменяет звонки с фото. */
@Serializable
data class BellsData(
    val mon: List<BellTime>? = null,
    /** Вторник–пятница. */
    val week: List<BellTime>? = null,
    val sat: List<BellTime>? = null,
    /** Поднятие флага. */
    val flag: BellRange? = null,
    val classHour: BellRange? = null,
)

@Serializable
data class OverrideDay(
    val note: String? = null,
    /** Своё расписание на день: пары колледжа не используются. */
    val replaceAll: Boolean = false,
    val pairs: List<OverridePair> = emptyList(),
    /** Время пар только на этот день (только изменённые пары). */
    val times: List<BellTime> = emptyList(),
    /** Поднятие флага: true — есть, false — нет, null — как обычно. */
    val flag: Boolean? = null,
    /** Классный час: true — есть, false — нет, null — как обычно. */
    val classHour: Boolean? = null,
)

@Serializable
data class OverridesData(
    val announcement: String? = null,
    val updatedAt: String? = null,
    val bells: BellsData? = null,
    val days: Map<String, OverrideDay> = emptyMap(),
) {
    fun day(date: LocalDate): OverrideDay? = days[date.toString()]
}

/** Текущие изменения (глобально — их использует Timeline.build; экраны перерисуются сами). */
object Overrides {
    var current: OverridesData by mutableStateOf(OverridesData())
}

class OverridesRepository(context: Context) {
    companion object {
        const val URL = "https://wtfhoshi.github.io/tkpst-schedule/overrides.json"
    }

    private val prefs = context.getSharedPreferences("overrides", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true }

    init {
        prefs.getString("data", null)?.let { raw ->
            runCatching { json.decodeFromString<OverridesData>(raw) }.getOrNull()?.let { Overrides.current = it }
        }
    }

    /**
     * Скачивает свежую версию. Возвращает даты (сегодня и дальше), где что-то поменялось,
     * или null, если скачать не удалось.
     */
    suspend fun refresh(today: LocalDate): Set<LocalDate>? = withContext(Dispatchers.IO) {
        val raw = runCatching { Http.get("$URL?t=${System.currentTimeMillis()}", 10_000, 8_000) }.getOrNull()
            ?: return@withContext null
        val fresh = runCatching { json.decodeFromString<OverridesData>(raw) }.getOrNull() ?: return@withContext null
        val old = Overrides.current
        if (fresh == old) return@withContext emptySet()
        val hadBaseline = prefs.contains("data")
        prefs.edit().putString("data", raw).apply()
        Overrides.current = fresh
        if (!hadBaseline) return@withContext emptySet()
        (old.days.keys + fresh.days.keys)
            .filter { old.days[it] != fresh.days[it] }
            .mapNotNull { runCatching { LocalDate.parse(it) }.getOrNull() }
            .filter { !it.isBefore(today) }
            .toSet()
    }
}
