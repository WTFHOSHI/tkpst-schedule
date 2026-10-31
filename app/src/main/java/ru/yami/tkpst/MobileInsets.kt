package ru.yami.tkpst

import android.view.View
import androidx.core.graphics.Insets
import androidx.core.view.WindowInsetsCompat

/** The native container owns occlusion on every WebView version, including pre-M139 IME handling. */
internal object MobileInsets {
    fun apply(view: View, insets: WindowInsetsCompat): WindowInsetsCompat {
        val safeTypes = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
        val handledTypes = safeTypes or WindowInsetsCompat.Type.ime()
        val padding = insets.getInsets(handledTypes)
        view.setPadding(padding.left, padding.top, padding.right, padding.bottom)
        // Send explicit zeros rather than CONSUMED so WebView also receives hide/update events.
        return WindowInsetsCompat.Builder(insets)
            .setInsets(handledTypes, Insets.NONE)
            .setInsetsIgnoringVisibility(safeTypes, Insets.NONE)
            .setDisplayCutout(null)
            .build()
    }
}
