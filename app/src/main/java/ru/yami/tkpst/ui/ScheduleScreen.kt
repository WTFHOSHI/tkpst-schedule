package ru.yami.tkpst.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import ru.yami.tkpst.data.BreakKind
import ru.yami.tkpst.data.Entry
import ru.yami.tkpst.data.LessonInfo
import ru.yami.tkpst.data.TYUMEN
import ru.yami.tkpst.data.Timeline
import java.time.DayOfWeek
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter

private enum class Phase { PAST, NOW, FUTURE, OTHER_DAY }

private fun phaseOf(e: Entry, isToday: Boolean, now: LocalTime): Phase = when {
    !isToday -> Phase.OTHER_DAY
    now >= e.end -> Phase.PAST
    now >= e.start -> Phase.NOW
    else -> Phase.FUTURE
}

private fun secondsBetween(a: LocalTime, b: LocalTime) = Duration.between(a, b).seconds

private fun progress(e: Entry, now: LocalTime): Float {
    val total = secondsBetween(e.start, e.end).toFloat()
    return if (total <= 0) 1f else (secondsBetween(e.start, now) / total).coerceIn(0f, 1f)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScheduleScreen(vm: ScheduleViewModel, onBack: () -> Unit, onSettings: () -> Unit) {
    val nowZ by rememberTyumenNow()
    val today = nowZ.toLocalDate()
    val now = nowZ.toLocalTime()

    // Свежие данные при каждом открытии экрана / возврате в приложение.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.onResume() }

    // Если приложение открыто в полночь — переезжаем на новый день сами.
    val lastToday = remember { arrayOf(today) }
    LaunchedEffect(today) {
        if (lastToday[0] != today) {
            if (vm.selected == lastToday[0]) vm.goToday()
            lastToday[0] = today
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Расписание", fontWeight = FontWeight.Bold)
                        Text(
                            "ИС-25-3С · сейчас ${nowZ.format(HM)}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад")
                    }
                },
                actions = {
                    if (vm.refreshing) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(14.dp))
                    } else {
                        IconButton(onClick = vm::refresh) {
                            Icon(Icons.Filled.Refresh, contentDescription = "Обновить")
                        }
                    }
                    IconButton(onClick = onSettings) {
                        Icon(Icons.Filled.Settings, contentDescription = "Настройки")
                    }
                },
            )
        },
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad)) {
            WeekBar(
                weekStart = vm.weekStart,
                selected = vm.selected,
                today = today,
                onPrev = { vm.shiftWeek(-1) },
                onNext = { vm.shiftWeek(1) },
                onToday = vm::goToday,
                onSelect = vm::select,
            )
            DayContent(vm, today, now)
        }
    }
}

@Composable
private fun WeekBar(
    weekStart: LocalDate,
    selected: LocalDate,
    today: LocalDate,
    onPrev: () -> Unit,
    onNext: () -> Unit,
    onToday: () -> Unit,
    onSelect: (LocalDate) -> Unit,
) {
    val fmt = DateTimeFormatter.ofPattern("d MMM", RU)
    Column(Modifier.padding(horizontal = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onPrev) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = "Прошлая неделя")
            }
            Text(
                "${weekStart.format(fmt)} – ${weekStart.plusDays(5).format(fmt)}",
                style = MaterialTheme.typography.titleMedium,
                textAlign = TextAlign.Center,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = onNext) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = "Следующая неделя")
            }
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            val names = listOf("Пн", "Вт", "Ср", "Чт", "Пт", "Сб")
            for (i in 0 until 6) {
                val d = weekStart.plusDays(i.toLong())
                DayChip(
                    name = names[i],
                    day = d.dayOfMonth,
                    selected = d == selected,
                    isToday = d == today,
                    onClick = { onSelect(d) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
        val showTodayButton = selected != today &&
            !(today.dayOfWeek == DayOfWeek.SUNDAY && selected == today)
        Box(Modifier.fillMaxWidth().height(40.dp), contentAlignment = Alignment.Center) {
            if (showTodayButton) {
                TextButton(onClick = onToday) {
                    Text(if (today.dayOfWeek == DayOfWeek.SUNDAY) "К сегодня (воскресенье)" else "К сегодняшнему дню")
                }
            }
        }
    }
}

@Composable
private fun DayChip(
    name: String,
    day: Int,
    selected: Boolean,
    isToday: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val cs = MaterialTheme.colorScheme
    Surface(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        color = if (selected) cs.primary else cs.surfaceContainerHigh,
        contentColor = if (selected) cs.onPrimary else cs.onSurface,
        border = if (isToday && !selected) BorderStroke(2.dp, cs.primary) else null,
    ) {
        Column(
            Modifier.padding(vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(name, style = MaterialTheme.typography.labelMedium)
            Text("$day", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            // Точка под сегодняшним днём
            val dot = when {
                !isToday -> Color.Transparent
                selected -> cs.onPrimary
                else -> cs.primary
            }
            Box(
                Modifier
                    .padding(top = 2.dp)
                    .size(5.dp)
                    .background(dot, CircleShape),
            )
        }
    }
}

@Composable
private fun DayContent(vm: ScheduleViewModel, today: LocalDate, now: LocalTime) {
    val date = vm.selected
    if (date.dayOfWeek == DayOfWeek.SUNDAY) {
        Message("Выходной", "В воскресенье пар нет. Отдыхай 🙂")
        return
    }
    when (val s = vm.state) {
        DayState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        is DayState.Error -> Message("Не удалось загрузить", s.message, action = "Повторить", onAction = vm::refresh)
        is DayState.Loaded -> {
            if (s.entries.isEmpty()) {
                if (s.data.notPublished) {
                    Message("Расписания ещё нет", "Колледж пока не опубликовал пары на этот день.")
                } else {
                    Message("Пар нет", "На этот день занятий не найдено.")
                }
                return
            }
            val isToday = date == today
            val listState = rememberLazyListState()
            // При открытии сегодняшнего дня прокручиваем к текущему/следующему блоку.
            LaunchedEffect(date, s.entries.size) {
                if (isToday) {
                    val idx = s.entries.indexOfFirst { now < it.end }
                    if (idx > 0) listState.scrollToItem((idx - 1).coerceAtLeast(0))
                }
            }
            LazyColumn(
                state = listState,
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (s.data.offline) {
                    item {
                        val at = if (s.data.savedAt > 0)
                            Instant.ofEpochMilli(s.data.savedAt).atZone(TYUMEN)
                                .format(DateTimeFormatter.ofPattern("d MMM, HH:mm", RU))
                        else "—"
                        Surface(
                            color = MaterialTheme.colorScheme.tertiaryContainer,
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            Text(
                                "Нет сети — показано сохранённое расписание ($at)",
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.fillMaxWidth().padding(10.dp),
                            )
                        }
                    }
                }
                if (isToday) {
                    item { DaySummary(s.entries, now) }
                }
                items(s.entries, key = { "${it::class.simpleName}-${it.start}" }) { e ->
                    val phase = phaseOf(e, isToday, now)
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

@Composable
private fun DaySummary(entries: List<Entry>, now: LocalTime) {
    val last = entries.last()
    val text = when {
        now < entries.first().start ->
            "До начала занятий ${Timeline.formatLeft(secondsBetween(now, entries.first().start))}"
        now >= last.end -> "Занятия на сегодня закончились"
        else -> "Занятия закончатся через ${Timeline.formatLeft(secondsBetween(now, last.end))} (в ${last.end.format(HM)})"
    }
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(vertical = 4.dp),
    )
}

@Composable
private fun TimerLine(e: Entry, phase: Phase, now: LocalTime, startWord: String, endWord: String) {
    when (phase) {
        Phase.FUTURE -> Text(
            "$startWord через ${Timeline.formatLeft(secondsBetween(now, e.start))}",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary,
        )
        Phase.NOW -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                "$endWord через ${Timeline.formatLeft(secondsBetween(now, e.end))}",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
            )
            LinearProgressIndicator(
                progress = { progress(e, now) },
                modifier = Modifier.fillMaxWidth().height(6.dp),
                trackColor = MaterialTheme.colorScheme.surfaceVariant,
            )
        }
        Phase.PAST -> Text(
            "Прошла",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Phase.OTHER_DAY -> Unit
    }
}

@Composable
private fun PairCard(e: Entry.Pair, phase: Phase, now: LocalTime) {
    val cs = MaterialTheme.colorScheme
    val active = phase == Phase.NOW
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = if (active) cs.primaryContainer else cs.surfaceContainerLow,
        border = if (active) BorderStroke(2.dp, cs.primary) else BorderStroke(1.dp, cs.outlineVariant),
        modifier = Modifier.fillMaxWidth().alpha(if (phase == Phase.PAST) 0.5f else 1f),
    ) {
        Row(Modifier.padding(16.dp)) {
            Column(
                Modifier.width(44.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("${e.number}", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = cs.primary)
                Text("пара", style = MaterialTheme.typography.labelSmall, color = cs.onSurfaceVariant)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    "${e.start.format(HM)} – ${e.end.format(HM)}",
                    style = MaterialTheme.typography.titleSmall,
                    color = cs.onSurfaceVariant,
                )
                e.lessons.forEachIndexed { i, l ->
                    if (i > 0) Spacer(Modifier.height(6.dp))
                    LessonBlock(l)
                }
                if (phase != Phase.OTHER_DAY) Spacer(Modifier.height(4.dp))
                TimerLine(e, phase, now, "Начнётся", "Закончится")
            }
        }
    }
}

@Composable
private fun LessonBlock(l: LessonInfo) {
    val cs = MaterialTheme.colorScheme
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (l.replaced) {
            Surface(color = cs.tertiaryContainer, contentColor = cs.onTertiaryContainer, shape = RoundedCornerShape(6.dp)) {
                Text("Замена", style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
            }
            l.oldTitle?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant, textDecoration = TextDecoration.LineThrough)
            }
        }
        Text(l.title.ifEmpty { "Без названия" }, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (l.oldCabinet != null && l.oldCabinet.isNotEmpty()) {
                Text("каб. ${l.oldCabinet}", style = MaterialTheme.typography.bodyMedium, color = cs.onSurfaceVariant, textDecoration = TextDecoration.LineThrough)
            }
            Text(
                if (l.cabinet.isNotEmpty()) "Кабинет ${l.cabinet}" else "Кабинет не указан",
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        if (l.oldTeacher != null && l.oldTeacher.isNotEmpty()) {
            Text(l.oldTeacher, style = MaterialTheme.typography.bodyMedium, color = cs.onSurfaceVariant, textDecoration = TextDecoration.LineThrough)
        }
        if (l.teacher.isNotEmpty()) {
            Text(l.teacher, style = MaterialTheme.typography.bodyMedium, color = cs.onSurfaceVariant)
        }
    }
}

@Composable
private fun ClassHourCard(e: Entry.ClassHour, phase: Phase, now: LocalTime) {
    val cs = MaterialTheme.colorScheme
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = cs.tertiaryContainer,
        contentColor = cs.onTertiaryContainer,
        border = if (phase == Phase.NOW) BorderStroke(2.dp, cs.tertiary) else null,
        modifier = Modifier.fillMaxWidth().alpha(if (phase == Phase.PAST) 0.5f else 1f),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                "Классный час · ${e.start.format(HM)} – ${e.end.format(HM)}",
                style = MaterialTheme.typography.labelLarge,
            )
            Text(e.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            if (e.cabinet.isNotEmpty()) Text("Кабинет ${e.cabinet}", style = MaterialTheme.typography.bodyMedium)
            if (phase != Phase.OTHER_DAY) Spacer(Modifier.height(2.dp))
            TimerLine(e, phase, now, "Начнётся", "Закончится")
        }
    }
}

@Composable
private fun BreakCard(e: Entry.Break, phase: Phase, now: LocalTime) {
    val cs = MaterialTheme.colorScheme
    val label = when (e.kind) {
        BreakKind.SHORT -> "Перерыв ${e.minutes} мин"
        BreakKind.BIG -> "Большой перерыв ${e.minutes} мин"
        BreakKind.WINDOW -> "Окно · ${Timeline.formatLeft(e.minutes * 60)}"
    }
    val active = phase == Phase.NOW
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = if (active) cs.secondaryContainer else Color.Transparent,
        border = BorderStroke(1.dp, if (active) cs.secondary else cs.outlineVariant),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp)
            .alpha(if (phase == Phase.PAST) 0.5f else 1f),
    ) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("☕ $label", style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
                Text(
                    "${e.start.format(HM)}–${e.end.format(HM)}",
                    style = MaterialTheme.typography.labelMedium,
                    color = cs.onSurfaceVariant,
                )
            }
            if (active) {
                Text(
                    "Закончится через ${Timeline.formatLeft(secondsBetween(now, e.end))}",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                    color = cs.primary,
                )
                LinearProgressIndicator(
                    progress = { progress(e, now) },
                    modifier = Modifier.fillMaxWidth().height(4.dp),
                    color = cs.secondary,
                    trackColor = cs.surfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun Message(title: String, text: String, action: String? = null, onAction: () -> Unit = {}) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
        Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        if (action != null) Button(onClick = onAction) { Text(action) }
    }
}
