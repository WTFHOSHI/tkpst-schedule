package ru.yami.tkpst.ui

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import android.graphics.Canvas
import androidx.activity.ComponentActivity
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import ru.yami.tkpst.data.ApiLesson
import ru.yami.tkpst.data.Entry
import ru.yami.tkpst.data.ThemeMode
import ru.yami.tkpst.data.Timeline
import java.io.File
import java.time.LocalDate
import java.time.LocalTime

/**
 * Рисует настоящие карточки расписания (тот же Compose-код, что в приложении)
 * с зафиксированным временем и сохраняет PNG в app/build/screenshots.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w400dp-h1000dp-xxhdpi", application = android.app.Application::class)
class ScheduleScreenshotTest {

    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    /** Вторник, 29.09.2026 — реальные пары ИС-25-3С из API. */
    private val day = LocalDate.of(2026, 9, 29)
    private val entries = Timeline.build(
        day,
        listOf(
            ApiLesson("ОП.14 Разработка мобильного приложения", "204", "Подобед Д.С.", 1, "08:15:00", "09:45:00"),
            ApiLesson("ОГСЭ.05 Физическая культура", "209-1", "Молоков А.Ю.", 2, "09:55:00", "11:25:00"),
            ApiLesson("МДК.05.03 Тестирование информационных систем", "410", "Шевченко О.В.", 3, "12:05:00", "13:35:00"),
        ),
    )

    private fun shot(name: String, now: LocalTime, theme: ThemeMode = ThemeMode.LIGHT) {
        var contentHeight = 0
        rule.setContent {
            AppTheme(theme) {
                Surface(color = MaterialTheme.colorScheme.background) {
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .onGloballyPositioned { contentHeight = it.size.height }
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            "Вт, 29 сентября · сейчас ${now.format(HM)}",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                        )
                        DaySummary(entries, now)
                        entries.forEach { e ->
                            val phase = phaseOf(e, isToday = true, now = now)
                            when (e) {
                                is Entry.Pair -> PairCard(e, phase, now)
                                is Entry.ClassHour -> ClassHourCard(e, phase, now)
                                is Entry.Break -> BreakCard(e, phase, now)
                            }
                        }
                    }
                }
            }
        }
        rule.waitForIdle()
        // Рисуем окно в картинку (как это делают Roborazzi/Paparazzi) и обрезаем по содержимому.
        val view = rule.activity.window.decorView
        val full = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        view.draw(Canvas(full))
        val h = contentHeight.coerceIn(1, full.height)
        val bmp = Bitmap.createBitmap(full, 0, 0, full.width, h)
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test fun lessonInProgress() = shot("1-para-idet", LocalTime.of(9, 10, 0))

    @Test fun breakInProgress() = shot("2-pereryv", LocalTime.of(9, 49, 0))

    @Test fun beforeLessons() = shot("3-do-nachala", LocalTime.of(7, 32, 0))

    @Test fun darkTheme() = shot("4-temnaya-tema", LocalTime.of(9, 10, 0), ThemeMode.DARK)
}
