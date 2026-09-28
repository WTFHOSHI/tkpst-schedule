package ru.yami.tkpst

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.lifecycle.viewmodel.compose.viewModel
import ru.yami.tkpst.data.ScheduleNotifier
import ru.yami.tkpst.ui.AddressScreen
import ru.yami.tkpst.ui.AppTheme
import ru.yami.tkpst.ui.BusScreen
import ru.yami.tkpst.ui.BusViewModel
import ru.yami.tkpst.ui.HomeScreen
import ru.yami.tkpst.ui.ScheduleScreen
import ru.yami.tkpst.ui.ScheduleViewModel
import ru.yami.tkpst.ui.SettingsScreen
import ru.yami.tkpst.ui.isDark

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as App
        ScheduleNotifier.ensureChannel(this)
        val startStack = if (intent?.getStringExtra(ScheduleNotifier.EXTRA_OPEN) == "schedule") "home/schedule" else "home"

        setContent {
            val mode = app.settings.theme
            val dark = mode.isDark(isSystemInDarkTheme())
            LaunchedEffect(dark) {
                val style = if (dark) SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
                else SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
                enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
            }

            // Разрешение на уведомления (Android 13+) — спрашиваем один раз.
            val notifPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
            LaunchedEffect(Unit) {
                if (Build.VERSION.SDK_INT >= 33 && !app.settings.askedNotifications) {
                    app.settings.askedNotifications = true
                    notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            }

            AppTheme(mode) {
                // Простой стек экранов: "home/buses/address"
                var stack by rememberSaveable { mutableStateOf(startStack) }
                val screens = stack.split('/')
                val screen = screens.last()
                val push: (String) -> Unit = { stack = "$stack/$it" }
                val pop: () -> Unit = { if (screens.size > 1) stack = screens.dropLast(1).joinToString("/") }
                BackHandler(enabled = screens.size > 1) { pop() }

                when (screen) {
                    "schedule" -> {
                        val vm: ScheduleViewModel = viewModel()
                        ScheduleScreen(vm, onBack = pop, onSettings = { push("settings") })
                    }
                    "buses" -> {
                        val vm: BusViewModel = viewModel()
                        BusScreen(vm, home = app.settings.home, onBack = pop, onEditAddress = { push("address") })
                    }
                    "address" -> AddressScreen(app.settings, onBack = pop)
                    "settings" -> SettingsScreen(
                        settings = app.settings,
                        onClearCache = { app.repository.clearCache() },
                        onEditAddress = { push("address") },
                        onBack = pop,
                    )
                    else -> HomeScreen(onOpen = push)
                }
            }
        }
    }
}
