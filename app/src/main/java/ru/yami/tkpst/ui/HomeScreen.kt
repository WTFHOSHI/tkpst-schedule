package ru.yami.tkpst.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import ru.yami.tkpst.App
import ru.yami.tkpst.data.DayChange
import ru.yami.tkpst.data.Overrides
import ru.yami.tkpst.data.ScheduleNotifier
import ru.yami.tkpst.data.TYUMEN
import java.time.LocalDate
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(onOpen: (String) -> Unit) {
    val now by rememberTyumenNow()
    val context = LocalContext.current
    // Подтягиваем изменения из админ-панели при каждом открытии главного экрана.
    LaunchedEffect(Unit) {
        val app = context.applicationContext as App
        val changed = app.overrides.refresh(LocalDate.now(TYUMEN)).orEmpty()
        ScheduleNotifier.notify(app, changed.associateWith { DayChange.CHANGED })
    }
    val announcement = Overrides.current.announcement?.trim().orEmpty()
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("ТКПСТ", fontWeight = FontWeight.Bold)
                        Text(
                            "Тюмень · " + now.format(DateTimeFormatter.ofPattern("EEEE, d MMMM · HH:mm", RU)),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                actions = {
                    IconButton(onClick = { onOpen("settings") }) {
                        Icon(Icons.Filled.Settings, contentDescription = "Настройки")
                    }
                },
            )
        },
    ) { pad ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(pad)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (announcement.isNotEmpty()) AnnouncementCard(announcement)
            BigButton(
                title = "Расписание",
                subtitle = "Пары группы ИС-25-3С",
                icon = Icons.Filled.DateRange,
                container = MaterialTheme.colorScheme.primaryContainer,
                content = MaterialTheme.colorScheme.onPrimaryContainer,
                onClick = { onOpen("schedule") },
            )
            BigButton(
                title = "Автобусы",
                subtitle = "Дом ↔ Луначарского, 19 · онлайн",
                icon = Icons.Filled.Place,
                container = MaterialTheme.colorScheme.secondaryContainer,
                content = MaterialTheme.colorScheme.onSecondaryContainer,
                onClick = { onOpen("buses") },
            )
        }
    }
}

@Composable
private fun ColumnScope.BigButton(
    title: String,
    subtitle: String,
    icon: ImageVector,
    container: Color,
    content: Color,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .weight(1f),
        shape = RoundedCornerShape(28.dp),
        colors = CardDefaults.cardColors(containerColor = container, contentColor = content),
    ) {
        Box(Modifier.fillMaxSize().padding(24.dp)) {
            Surface(
                shape = CircleShape,
                color = content.copy(alpha = 0.12f),
                contentColor = content,
                modifier = Modifier.size(64.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(icon, contentDescription = null, modifier = Modifier.size(32.dp))
                }
            }
            Column(Modifier.align(Alignment.BottomStart)) {
                Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(4.dp))
                Row { Text(subtitle, style = MaterialTheme.typography.bodyLarge) }
            }
        }
    }
}
