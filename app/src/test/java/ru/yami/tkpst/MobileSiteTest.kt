package ru.yami.tkpst

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import ru.yami.tkpst.data.HomeAddress
import ru.yami.tkpst.data.Settings
import ru.yami.tkpst.data.ThemeMode
import ru.yami.tkpst.data.transit.LatLng

@RunWith(RobolectricTestRunner::class)
class MobileSiteTest {
    @Test fun onlyTheAccountHostCanOpenInsideTheApp() {
        assertTrue(MobileSite.isTrusted(MobileSite.START_URL))
        assertTrue(MobileSite.isTrusted(MobileSite.ORIGIN + "/#/grades"))
        assertFalse(MobileSite.isTrusted("http://tkpst-account.telling-math.workers.dev/"))
        assertFalse(MobileSite.isTrusted("https://tkpst-account.telling-math.workers.dev.evil.test/"))
        assertFalse(MobileSite.isTrusted("https://tkpst-account.telling-math.workers.dev@evil.test/"))
    }

    @Test fun oldThemeAndHomeCanMoveIntoTheWebViewWithoutBreakingJavaScript() {
        val settings = Settings(RuntimeEnvironment.getApplication())
        settings.updateTheme(ThemeMode.DARK)
        settings.updateHome(HomeAddress("Дом 'на углу'", LatLng(57.16, 65.51)))
        val script = MobileSite.migrationScript(settings)
        assertTrue(script.contains("\"theme\":\"dark\""))
        assertTrue(script.contains("Дом 'на углу'"))
        assertTrue(script.contains("tkpst_mobile_migrated_v1"))
        assertTrue(script.contains("localStorage.getItem('home') === null"))
    }
}
