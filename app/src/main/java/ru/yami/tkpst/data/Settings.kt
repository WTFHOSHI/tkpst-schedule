package ru.yami.tkpst.data

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ru.yami.tkpst.data.transit.LatLng

enum class ThemeMode(val label: String) {
    SYSTEM("Как в системе"),
    LIGHT("Светлая"),
    DARK("Тёмная"),
}

data class HomeAddress(val label: String, val point: LatLng)

/** Настройки приложения. Хранятся только на телефоне. */
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

    var home by mutableStateOf(readHome())
        private set

    private fun readHome(): HomeAddress? {
        val label = prefs.getString("home_label", null) ?: return null
        if (!prefs.contains("home_lat")) return null
        val lat = Double.fromBits(prefs.getLong("home_lat", 0))
        val lon = Double.fromBits(prefs.getLong("home_lon", 0))
        return HomeAddress(label, LatLng(lat, lon))
    }

    fun updateHome(address: HomeAddress) {
        home = address
        prefs.edit()
            .putString("home_label", address.label)
            .putLong("home_lat", address.point.lat.toRawBits())
            .putLong("home_lon", address.point.lon.toRawBits())
            .apply()
    }

    /** Разрешение на уведомления спрашиваем один раз. */
    var askedNotifications: Boolean
        get() = prefs.getBoolean("asked_notifications", false)
        set(v) = prefs.edit().putBoolean("asked_notifications", v).apply()
}
