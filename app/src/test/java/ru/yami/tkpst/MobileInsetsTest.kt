package ru.yami.tkpst

import android.widget.FrameLayout
import androidx.core.graphics.Insets
import androidx.core.view.WindowInsetsCompat
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class, sdk = [35])
class MobileInsetsTest {
    @Test fun systemAndCutoutInsetsAreAppliedOnceInPortraitAndLandscape() {
        for ((bars, cutout) in listOf(
            Insets.of(0, 24, 0, 48) to Insets.of(0, 40, 0, 0),
            Insets.of(0, 24, 48, 0) to Insets.of(42, 0, 0, 0),
        )) {
            val root = FrameLayout(RuntimeEnvironment.getApplication())
            val incoming = WindowInsetsCompat.Builder()
                .setInsets(WindowInsetsCompat.Type.systemBars(), bars)
                .setInsets(WindowInsetsCompat.Type.displayCutout(), cutout)
                .build()
            val child = MobileInsets.apply(root, incoming)
            assertEquals(maxOf(bars.left, cutout.left), root.paddingLeft)
            assertEquals(maxOf(bars.top, cutout.top), root.paddingTop)
            assertEquals(maxOf(bars.right, cutout.right), root.paddingRight)
            assertEquals(bars.bottom, root.paddingBottom)
            assertEquals(Insets.NONE, child.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()))
        }
    }

    @Test fun keyboardUsesMaximumOcclusionAndHidingRestoresNavigationPadding() {
        val root = FrameLayout(RuntimeEnvironment.getApplication())
        for (keyboard in listOf(300, 360, 0)) {
            val incoming = WindowInsetsCompat.Builder()
                .setInsets(WindowInsetsCompat.Type.systemBars(), Insets.of(0, 24, 0, 48))
                .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, keyboard))
                .build()
            val child = MobileInsets.apply(root, incoming)
            assertEquals(maxOf(48, keyboard), root.paddingBottom)
            assertEquals(24, root.paddingTop)
            assertEquals(Insets.NONE, child.getInsets(WindowInsetsCompat.Type.ime()))
        }
    }
}
