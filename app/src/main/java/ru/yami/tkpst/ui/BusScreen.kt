package ru.yami.tkpst.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import ru.yami.tkpst.data.HomeAddress
import ru.yami.tkpst.data.Timeline
import ru.yami.tkpst.data.transit.Geo
import ru.yami.tkpst.data.transit.Router
import java.time.Duration
import java.time.LocalDateTime

private const val LIVE_REFRESH_MS = 30_000L

private fun untilText(now: LocalDateTime, t: LocalDateTime): String {
    val s = Duration.between(now, t).seconds
    return if (s <= 30) "сейчас" else "через ${Timeline.formatLeft(s)}"
}

private fun shortUntil(now: LocalDateTime, t: LocalDateTime): String {
    val s = Duration.between(now, t).seconds
    return if (s < 60) "сейчас" else "${(s + 59) / 60} мин"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BusScreen(vm: BusViewModel, home: HomeAddress?, onBack: () -> Unit, onEditAddress: () -> Unit) {
    val nowZ by rememberTyumenNow()
    val now = nowZ.toLocalDateTime()

    // Живые данные: обновление при открытии и каждые 30 секунд, пока экран на виду.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle, home) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            vm.refresh(force = true)
            while (true) {
                delay(LIVE_REFRESH_MS)
                vm.refresh(force = true)
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Автобусы", fontWeight = FontWeight.Bold)
                        Text(
                            "Тюмень · сейчас ${nowZ.format(HM)}",
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
                        IconButton(onClick = { vm.refresh(force = true) }) {
                            Icon(Icons.Filled.Refresh, contentDescription = "Обновить")
                        }
                    }
                    IconButton(onClick = onEditAddress) {
                        Icon(Icons.Filled.Home, contentDescription = "Домашний адрес")
                    }
                },
            )
        },
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad)) {
            if (home == null) {
                CenterMessage(
                    "Укажи домашний адрес",
                    "Нужен, чтобы найти остановки рядом с домом и автобусы до колледжа и обратно. " +
                        "Адрес хранится только на телефоне.",
                    action = "Указать адрес", onAction = onEditAddress,
                )
                return@Column
            }
            TabRow(selectedTabIndex = vm.direction.ordinal) {
                Direction.entries.forEach { d ->
                    Tab(
                        selected = vm.direction == d,
                        onClick = { vm.selectDirection(d) },
                        text = { Text(d.title) },
                    )
                }
            }
            val (fromLabel, toLabel) = when (vm.direction) {
                Direction.TO_COLLEGE -> home.label to Geo.COLLEGE_LABEL
                Direction.TO_HOME -> Geo.COLLEGE_LABEL to home.label
            }
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                Text(
                    "$fromLabel → $toLabel",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = vm.sort == Router.Sort.DURATION,
                        onClick = { vm.selectSort(Router.Sort.DURATION) },
                        label = { Text("Меньше в пути") },
                    )
                    FilterChip(
                        selected = vm.sort == Router.Sort.ARRIVAL,
                        onClick = { vm.selectSort(Router.Sort.ARRIVAL) },
                        label = { Text("Раньше приеду") },
                    )
                }
            }
            BusContent(vm, now, vm.direction)
        }
    }
}

@Composable
private fun BusContent(vm: BusViewModel, now: LocalDateTime, direction: Direction) {
    when (val s = vm.state) {
        BusState.NoHome -> Unit
        is BusState.LoadingNetwork -> Column(
            Modifier.fillMaxSize().padding(32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Загружаю маршруты города", style = MaterialTheme.typography.titleMedium)
            LinearProgressIndicator(
                progress = { if (s.total == 0) 0f else s.done.toFloat() / s.total },
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                "${s.done} из ${s.total} · это делается один раз в день",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
        BusState.Searching -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                CircularProgressIndicator()
                Text("Ищу маршруты…", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        is BusState.Error -> CenterMessage("Ошибка", s.message, action = "Повторить", onAction = { vm.refresh(force = true, showSpinner = true) })
        is BusState.Ready -> LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (s.journeys.isEmpty()) {
                item {
                    InfoCard(
                        if (s.noStopsNearby) "В радиусе километра нет остановок."
                        else "Сейчас не нашлось автобусов по этому направлению (возможно, уже ночь). " +
                            "Посмотри ближайшие автобусы ниже."
                    )
                }
            } else {
                item { SectionTitle("Лучшие маршруты") }
                items(s.journeys, key = { it.plan.key + it.legs.first().board }) { j ->
                    JourneyCard(j, now, direction)
                }
            }
            if (s.boards.isNotEmpty()) {
                item { SectionTitle("Ближайшие автобусы") }
                items(s.boards, key = { "b" + it.stop.id }) { StopBoardCard(it, now) }
            }
            item {
                Text(
                    "Обновлено в ${s.updatedAt.format(HM)} · онлайн-данные Тюменьгортранса, обновление каждые 30 с. " +
                        "Время в пути — примерное.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 8.dp),
    )
}

@Composable
private fun InfoCard(text: String) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(16.dp)) {
        Text(text, modifier = Modifier.fillMaxWidth().padding(16.dp))
    }
}

@Composable
fun RouteBadge(name: String, highlighted: Boolean = true) {
    val cs = MaterialTheme.colorScheme
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = if (highlighted) cs.primary else cs.surfaceVariant,
        contentColor = if (highlighted) cs.onPrimary else cs.onSurfaceVariant,
    ) {
        Text(
            name,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun JourneyCard(j: Router.Journey, now: LocalDateTime, direction: Direction) {
    val cs = MaterialTheme.colorScheme
    val target = if (direction == Direction.TO_COLLEGE) "колледжа" else "дома"
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = cs.surfaceContainerLow,
        border = BorderStroke(1.dp, cs.outlineVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // Шапка: время в пути, прибытие
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("${j.durationMin} мин", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text(
                        if (j.legs.size == 1) "в пути · без пересадок" else "в пути · 1 пересадка",
                        style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant,
                    )
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text("прибытие", style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
                    Text(j.arrive.format(HM), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                }
            }
            // Номера
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                j.legs.forEachIndexed { i, l ->
                    if (i > 0) Text("→", color = cs.onSurfaceVariant)
                    RouteBadge(l.leg.routeName)
                }
                if (j.alternatives.isNotEmpty()) {
                    Text(
                        "или " + j.alternatives.take(5).joinToString(", ") { "№$it" },
                        style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant,
                    )
                }
            }
            // Когда выходить
            val leaveSec = Duration.between(now, j.leaveAt).seconds
            Surface(color = cs.primaryContainer, contentColor = cs.onPrimaryContainer, shape = RoundedCornerShape(12.dp)) {
                Text(
                    if (leaveSec <= 30) "Выходи сейчас" else "Выходи через ${Timeline.formatLeft(leaveSec)} (в ${j.leaveAt.format(HM)})",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }
            // Шаги
            Step("Пешком ${j.plan.walkStart.minutes.toInt().coerceAtLeast(1)} мин · ${j.plan.walkStart.meters} м до «${j.legs.first().leg.from.name}»",
                j.legs.first().leg.from.desc)
            j.legs.forEachIndexed { i, tl ->
                if (i > 0) {
                    val tw = j.plan.transferWalk
                    val same = tw == null || tw.meters < 30
                    Step(
                        if (same) "Пересадка на той же остановке «${tl.leg.from.name}»"
                        else "Пересадка: пешком ${tw!!.minutes.toInt().coerceAtLeast(1)} мин · ${tw.meters} м до «${tl.leg.from.name}»",
                        if (same) null else tl.leg.from.desc,
                    )
                }
                BusStep(tl, now)
            }
            Step("Пешком ${j.plan.walkEnd.minutes.toInt().coerceAtLeast(1)} мин · ${j.plan.walkEnd.meters} м до $target", null)
        }
    }
}

@Composable
private fun Step(title: String, subtitle: String?) {
    Row {
        Box(
            Modifier
                .padding(top = 7.dp)
                .size(6.dp)
                .background(MaterialTheme.colorScheme.outline, CircleShape),
        )
        Spacer(Modifier.width(10.dp))
        Column {
            Text(title, style = MaterialTheme.typography.bodyMedium)
            if (!subtitle.isNullOrBlank()) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun BusStep(tl: Router.TimedLeg, now: LocalDateTime) {
    val cs = MaterialTheme.colorScheme
    Row(verticalAlignment = Alignment.Top) {
        RouteBadge(tl.leg.routeName)
        Spacer(Modifier.width(10.dp))
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "${untilText(now, tl.board)} · ${tl.board.format(HM)}",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.primary,
                )
                Spacer(Modifier.width(8.dp))
                Surface(
                    shape = RoundedCornerShape(6.dp),
                    color = if (tl.live) cs.secondaryContainer else cs.surfaceVariant,
                    contentColor = if (tl.live) cs.onSecondaryContainer else cs.onSurfaceVariant,
                ) {
                    Text(
                        if (tl.live) "онлайн" else "по графику",
                        style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
            }
            val rideMin = Duration.between(tl.board, tl.alight).toMinutes().coerceAtLeast(1)
            Text(
                "Проезд ~$rideMin мин, ${tl.leg.stopsCount} ост. до «${tl.leg.to.name}»",
                style = MaterialTheme.typography.bodySmall,
                color = cs.onSurfaceVariant,
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StopBoardCard(b: StopBoard, now: LocalDateTime) {
    val cs = MaterialTheme.colorScheme
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = cs.surfaceContainerLow,
        border = BorderStroke(1.dp, cs.outlineVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(b.stop.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    if (b.stop.desc.isNotBlank()) {
                        Text(b.stop.desc, style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
                    }
                }
                Text(
                    "${b.walk.minutes.toInt().coerceAtLeast(1)} мин пешком",
                    style = MaterialTheme.typography.labelMedium,
                    color = cs.onSurfaceVariant,
                )
            }
            if (b.arrivals.isEmpty()) {
                Text("Нет онлайн-данных по этой остановке", style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
            }
            b.arrivals.forEach { r ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.width(56.dp)) { RouteBadge(r.routeName, highlighted = r.useful) }
                    Text(
                        r.times.joinToString(" · ") { shortUntil(now, it) },
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = if (r.useful) FontWeight.SemiBold else FontWeight.Normal,
                    )
                }
            }
            if (b.arrivals.any { it.useful }) {
                Text(
                    "Выделены номера, которые идут в нужную сторону",
                    style = MaterialTheme.typography.labelSmall,
                    color = cs.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun CenterMessage(title: String, text: String, action: String? = null, onAction: () -> Unit = {}) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
        Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        if (action != null) {
            Spacer(Modifier.height(4.dp))
            Button(onClick = onAction) { Text(action) }
        }
    }
}
