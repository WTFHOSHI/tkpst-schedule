package ru.yami.tkpst.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.produceState
import kotlinx.coroutines.delay
import ru.yami.tkpst.data.TYUMEN
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

val RU: Locale = Locale.forLanguageTag("ru")
val HM: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

/** Текущее время Тюмени, обновляется каждую секунду ровно на границе секунды. */
@Composable
fun rememberTyumenNow(): State<ZonedDateTime> = produceState(ZonedDateTime.now(TYUMEN)) {
    while (true) {
        value = ZonedDateTime.now(TYUMEN)
        delay(1000 - System.currentTimeMillis() % 1000)
    }
}
