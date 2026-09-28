package ru.yami.tkpst.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import ru.yami.tkpst.data.ThemeMode

// Зелёная гамма в духе листа «Расписание звонков»
private val Light = lightColorScheme(
    primary = Color(0xFF4F6F2F),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD6E8C2),
    onPrimaryContainer = Color(0xFF142000),
    secondary = Color(0xFF5A6350),
    secondaryContainer = Color(0xFFE2EAD6),
    onSecondaryContainer = Color(0xFF181E12),
    tertiary = Color(0xFF8A5A1F),
    tertiaryContainer = Color(0xFFFBE3C6),
    onTertiaryContainer = Color(0xFF2D1600),
    background = Color(0xFFF6F8F1),
    onBackground = Color(0xFF1A1C17),
    surface = Color(0xFFF6F8F1),
    onSurface = Color(0xFF1A1C17),
    surfaceVariant = Color(0xFFE1E5D8),
    onSurfaceVariant = Color(0xFF44483E),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color(0xFFF0F3EA),
    surfaceContainer = Color(0xFFEBEEE4),
    surfaceContainerHigh = Color(0xFFE5E8DE),
    outline = Color(0xFF75796C),
    outlineVariant = Color(0xFFC5C8BA),
)

private val Dark = darkColorScheme(
    primary = Color(0xFFB2D38F),
    onPrimary = Color(0xFF223600),
    primaryContainer = Color(0xFF384F1A),
    onPrimaryContainer = Color(0xFFD6E8C2),
    secondary = Color(0xFFC1CAB4),
    secondaryContainer = Color(0xFF3F4837),
    onSecondaryContainer = Color(0xFFDDE6D0),
    tertiary = Color(0xFFF1BD7E),
    tertiaryContainer = Color(0xFF6A430C),
    onTertiaryContainer = Color(0xFFFBE3C6),
    background = Color(0xFF121410),
    onBackground = Color(0xFFE3E3DB),
    surface = Color(0xFF121410),
    onSurface = Color(0xFFE3E3DB),
    surfaceVariant = Color(0xFF44483E),
    onSurfaceVariant = Color(0xFFC5C8BA),
    surfaceContainerLowest = Color(0xFF0D0F0B),
    surfaceContainerLow = Color(0xFF1A1C17),
    surfaceContainer = Color(0xFF1E211B),
    surfaceContainerHigh = Color(0xFF292B25),
    outline = Color(0xFF8F9285),
    outlineVariant = Color(0xFF44483E),
)

@Composable
fun AppTheme(mode: ThemeMode, content: @Composable () -> Unit) {
    val dark = when (mode) {
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }
    MaterialTheme(colorScheme = if (dark) Dark else Light, content = content)
}

fun ThemeMode.isDark(system: Boolean) = when (this) {
    ThemeMode.SYSTEM -> system
    ThemeMode.LIGHT -> false
    ThemeMode.DARK -> true
}
