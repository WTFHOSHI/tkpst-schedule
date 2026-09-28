package ru.yami.tkpst.data.transit

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationManager
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.os.CancellationSignal
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/** Разовое определение местоположения без Google Play Services. */
object Locator {
    @SuppressLint("MissingPermission") // разрешение проверяется в UI перед вызовом
    suspend fun current(context: Context): LatLng? {
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .filter { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) }
        if (providers.isEmpty()) return null

        // Сначала GPS (точнее), потом сеть.
        for (provider in providers) {
            val loc = withTimeoutOrNull(15_000) {
                suspendCancellableCoroutine<Location?> { cont ->
                    val signal = CancellationSignal()
                    cont.invokeOnCancellation { signal.cancel() }
                    LocationManagerCompat.getCurrentLocation(
                        lm, provider, signal, ContextCompat.getMainExecutor(context),
                    ) { location -> if (cont.isActive) cont.resume(location) }
                }
            }
            if (loc != null) return LatLng(loc.latitude, loc.longitude)
        }
        // Запасной вариант — последнее известное положение.
        return providers.mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
            .maxByOrNull { it.time }
            ?.let { LatLng(it.latitude, it.longitude) }
    }
}
