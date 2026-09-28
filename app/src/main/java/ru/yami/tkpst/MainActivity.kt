package ru.yami.tkpst

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.lifecycle.viewmodel.compose.viewModel
import ru.yami.tkpst.ui.AppTheme
import ru.yami.tkpst.ui.BusesScreen
import ru.yami.tkpst.ui.HomeScreen
import ru.yami.tkpst.ui.ScheduleScreen
import ru.yami.tkpst.ui.ScheduleViewModel
import ru.yami.tkpst.ui.SettingsScreen
import ru.yami.tkpst.ui.isDark

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as App
        setContent {
            val mode = app.settings.theme
            val dark = mode.isDark(isSystemInDarkTheme())
            LaunchedEffect(dark) {
                val style = if (dark) SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
                else SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
                enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
            }
            AppTheme(mode) {
                var screen by rememberSaveable { mutableStateOf("home") }
                var backTo by rememberSaveable { mutableStateOf("home") }
                BackHandler(enabled = screen != "home") {
                    screen = if (screen == "settings") backTo else "home"
                }
                val open: (String) -> Unit = { target ->
                    if (target == "settings") backTo = screen
                    screen = target
                }
                when (screen) {
                    "schedule" -> {
                        val vm: ScheduleViewModel = viewModel()
                        ScheduleScreen(vm, onBack = { screen = "home" }, onSettings = { open("settings") })
                    }
                    "buses" -> BusesScreen(onBack = { screen = "home" })
                    "settings" -> SettingsScreen(
                        settings = app.settings,
                        onClearCache = { app.repository.clearCache() },
                        onBack = { screen = backTo },
                    )
                    else -> HomeScreen(onOpen = open)
                }
            }
        }
    }
}
