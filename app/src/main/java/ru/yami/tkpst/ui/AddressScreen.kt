package ru.yami.tkpst.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.yami.tkpst.data.HomeAddress
import ru.yami.tkpst.data.Settings
import ru.yami.tkpst.data.transit.Geocoder
import ru.yami.tkpst.data.transit.Locator
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddressScreen(settings: Settings, onBack: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<Geocoder.Place>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var gpsBusy by remember { mutableStateOf(false) }
    var gpsFound by remember { mutableStateOf<Geocoder.Place?>(null) }

    // Подсказки с задержкой, чтобы не спамить сервер на каждую букву.
    LaunchedEffect(query) {
        error = null
        if (query.trim().length < 3) {
            results = emptyList(); return@LaunchedEffect
        }
        delay(700)
        searching = true
        results = runCatching { Geocoder.search(query) }
            .onFailure { error = "Не удалось найти адрес. Проверь интернет." }
            .getOrDefault(emptyList())
        if (results.isEmpty() && error == null) error = "Ничего не нашлось. Попробуй «улица, дом»."
        searching = false
    }

    fun locate() {
        gpsBusy = true
        error = null
        scope.launch {
            val point = Locator.current(ctx)
            if (point == null) {
                error = "Не удалось определить местоположение. Включи геолокацию и попробуй на улице или у окна."
            } else {
                gpsFound = Geocoder.reverse(point)
                    ?: Geocoder.Place(
                        "Точка по GPS",
                        String.format(Locale.US, "%.5f, %.5f", point.lat, point.lon),
                        point,
                    )
            }
            gpsBusy = false
        }
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted.values.any { it }) locate()
        else error = "Без доступа к геолокации можно ввести адрес вручную."
    }

    fun save(p: Geocoder.Place) {
        val label = if (p.subtitle.isNotBlank() && p.title == "Точка по GPS") "${p.title} (${p.subtitle})" else p.title
        settings.updateHome(HomeAddress(label, p.point))
        onBack()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Домашний адрес") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад")
                    }
                },
            )
        },
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).padding(horizontal = 16.dp)) {
            settings.home?.let {
                Text(
                    "Сейчас: ${it.label}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
            }
            OutlinedTextField(
                value = query,
                onValueChange = { query = it; gpsFound = null },
                label = { Text("Улица и дом") },
                placeholder = { Text("например, Широтная 100") },
                singleLine = true,
                trailingIcon = {
                    if (searching) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.size(8.dp))
            OutlinedButton(
                onClick = {
                    val has = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
                        .any { ContextCompat.checkSelfPermission(ctx, it) == PackageManager.PERMISSION_GRANTED }
                    if (has) locate()
                    else permission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                },
                enabled = !gpsBusy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (gpsBusy) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                    Text("Определяю…")
                } else {
                    Icon(Icons.Filled.LocationOn, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Я сейчас дома — определить по GPS")
                }
            }

            gpsFound?.let { p ->
                Surface(
                    color = MaterialTheme.colorScheme.primaryContainer,
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                ) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Найдено по GPS", style = MaterialTheme.typography.labelMedium)
                        Text(p.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        if (p.subtitle.isNotBlank()) Text(p.subtitle, style = MaterialTheme.typography.bodySmall)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
                            Button(onClick = { save(p) }) { Text("Это мой дом") }
                            TextButton(onClick = { gpsFound = null }) { Text("Отмена") }
                        }
                    }
                }
            }

            error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 12.dp))
            }

            LazyColumn(Modifier.weight(1f, fill = false).padding(top = 8.dp)) {
                items(results) { p ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable { save(p) }
                            .padding(vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Filled.Place, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Text(p.title, style = MaterialTheme.typography.bodyLarge)
                            if (p.subtitle.isNotBlank()) {
                                Text(p.subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    HorizontalDivider()
                }
            }
            Text(
                "Адрес хранится только на телефоне. Поиск адресов — OpenStreetMap.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(vertical = 12.dp),
            )
        }
    }
}
