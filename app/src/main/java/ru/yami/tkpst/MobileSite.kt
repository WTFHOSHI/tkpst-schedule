package ru.yami.tkpst

import org.json.JSONObject
import ru.yami.tkpst.data.Settings
import java.net.URI

/** One trusted account origin serves the mobile interface and its private API. */
object MobileSite {
    const val ORIGIN = "https://tkpst-account.telling-math.workers.dev"
    const val START_URL = "$ORIGIN/#/schedule"

    fun isTrusted(url: String): Boolean = runCatching {
        val parsed = URI(url)
        parsed.scheme.equals("https", ignoreCase = true) &&
            parsed.host?.equals("tkpst-account.telling-math.workers.dev", ignoreCase = true) == true &&
            parsed.userInfo == null && (parsed.port == -1 || parsed.port == 443)
    }.getOrDefault(false)

    /** Copy old native preferences only into empty web settings, once. */
    fun migrationScript(settings: Settings): String {
        val data = JSONObject().put("theme", settings.theme.name.lowercase())
        settings.home?.let { home ->
            data.put("home", JSONObject()
                .put("label", home.label)
                .put("point", JSONObject().put("lat", home.point.lat).put("lon", home.point.lon)))
        }
        return """
            (() => { try {
              if (localStorage.getItem('tkpst_mobile_migrated_v1') !== null) return 'done';
              const old = $data;
              let changed = false;
              if (localStorage.getItem('theme') === null) {
                localStorage.setItem('theme', JSON.stringify(old.theme)); changed = true;
              }
              if (old.home && localStorage.getItem('home') === null) {
                localStorage.setItem('home', JSON.stringify(old.home)); changed = true;
              }
              localStorage.setItem('tkpst_mobile_migrated_v1', '1');
              return changed ? 'reload' : 'done';
            } catch (_) { return 'done'; } })();
        """.trimIndent()
    }
}
