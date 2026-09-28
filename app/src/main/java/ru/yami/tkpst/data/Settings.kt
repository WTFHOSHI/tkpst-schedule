package ru.yami.tkpst.data

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

enum class ThemeMode(val label: String) {
    SYSTEM("Как в системе"),
    LIGHT("Светлая"),
    DARK("Тёмная"),
}

/** Настройки приложения (тема). Хранятся только на телефоне. */
class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)

    var theme by mutableStateOf(
        runCatching { ThemeMode.valueOf(prefs.getString("theme", null) ?: "SYSTEM") }
            .getOrDefault(ThemeMode.SYSTEM)
    )
        private set

    fun updateTheme(mode: ThemeMode) {
        theme = mode
        prefs.edit().putString("theme", mode.name).apply()
    }
}
