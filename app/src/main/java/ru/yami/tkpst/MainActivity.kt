package ru.yami.tkpst

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import ru.yami.tkpst.data.ScheduleNotifier

class MainActivity : ComponentActivity() {
    private lateinit var site: WebView
    private lateinit var overlay: LinearLayout
    private lateinit var progress: ProgressBar
    private lateinit var message: TextView
    private lateinit var retry: Button
    private var failed = false
    private var pendingLocation: Pair<String, GeolocationPermissions.Callback>? = null

    private val locationPermission = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
        val allowed = grants.values.any { it }
        pendingLocation?.let { (origin, callback) -> callback.invoke(origin, allowed, false) }
        pendingLocation = null
    }
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ScheduleNotifier.ensureChannel(this)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        if (Build.VERSION.SDK_INT >= 29) window.isNavigationBarContrastEnforced = false

        site = WebView(this).apply {
            setBackgroundColor(Color.rgb(246, 248, 241))
            overScrollMode = View.OVER_SCROLL_NEVER
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
            settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportMultipleWindows(false)
            CookieManager.getInstance().setAcceptCookie(true)
            addJavascriptInterface(AppearanceBridge(), "TkpstTheme")
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (!request.isForMainFrame || MobileSite.isTrusted(request.url.toString())) return false
                    if (request.hasGesture() && request.url.scheme in listOf("https", "http")) {
                        runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                    }
                    return true
                }

                override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                    failed = false
                }

                override fun onPageFinished(view: WebView, url: String) {
                    if (failed || !MobileSite.isTrusted(url) || isDestroyed) return
                    view.evaluateJavascript(MobileSite.migrationScript((application as App).settings)) { result ->
                        if (result == "\"reload\"") view.reload()
                        else {
                            observeAppearance(view)
                            this@MainActivity.overlay.visibility = View.GONE
                            requestNotificationsOnce()
                        }
                    }
                }

                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) showFailure()
                }

                override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                    if (request.isForMainFrame && response.statusCode >= 400) showFailure()
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                    if (!MobileSite.isTrusted(origin)) { callback.invoke(origin, false, false); return }
                    val granted = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
                        .any { ContextCompat.checkSelfPermission(this@MainActivity, it) == PackageManager.PERMISSION_GRANTED }
                    if (granted) callback.invoke(origin, true, false)
                    else {
                        pendingLocation = origin to callback
                        locationPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                    }
                }
            }
        }

        progress = ProgressBar(this)
        message = TextView(this).apply {
            text = "Загружаем ТКПСТ…"
            textSize = 16f
            setTextColor(Color.rgb(26, 28, 23))
            gravity = Gravity.CENTER
        }
        retry = Button(this).apply {
            text = "Повторить"
            visibility = View.GONE
            setOnClickListener {
                failed = false
                progress.visibility = View.VISIBLE
                retry.visibility = View.GONE
                message.text = "Загружаем ТКПСТ…"
                site.reload()
            }
        }
        overlay = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.rgb(246, 248, 241))
            addView(progress)
            addView(message)
            addView(retry)
        }
        val root = FrameLayout(this).apply {
            addView(site, FrameLayout.LayoutParams(-1, -1))
            addView(this@MainActivity.overlay, FrameLayout.LayoutParams(-1, -1))
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            view.setPadding(0, 0, 0, insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom)
            insets
        }
        setContentView(root)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (site.canGoBack()) site.goBack() else finish()
            }
        })
        site.loadUrl(MobileSite.START_URL)
    }

    private fun showFailure() {
        failed = true
        progress.visibility = View.GONE
        message.text = "Не удалось открыть приложение. Проверьте соединение."
        retry.visibility = View.VISIBLE
        overlay.visibility = View.VISIBLE
    }

    private fun observeAppearance(view: WebView) {
        view.evaluateJavascript("""
            (() => {
              if (window.__tkpstNativeAppearance) return;
              window.__tkpstNativeAppearance = true;
              const report = () => window.TkpstTheme.appearanceChanged(document.documentElement.dataset.appearance || 'light');
              new MutationObserver(report).observe(document.documentElement, { attributes: true, attributeFilter: ['data-appearance'] });
              report();
            })();
        """.trimIndent(), null)
    }

    private inner class AppearanceBridge {
        @JavascriptInterface fun appearanceChanged(value: String) {
            runOnUiThread {
                if (isDestroyed) return@runOnUiThread
                val light = value != "dark"
                WindowCompat.getInsetsController(window, site).isAppearanceLightStatusBars = light
                WindowCompat.getInsetsController(window, site).isAppearanceLightNavigationBars = light
            }
        }
    }

    private fun requestNotificationsOnce() {
        if (Build.VERSION.SDK_INT < 33) return
        val settings = (application as App).settings
        if (settings.askedNotifications) return
        settings.askedNotifications = true
        notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getStringExtra(ScheduleNotifier.EXTRA_OPEN) == "schedule") {
            site.evaluateJavascript("location.hash = '#/schedule'", null)
        }
    }

    override fun onPause() { super.onPause(); if (::site.isInitialized) site.onPause() }
    override fun onResume() { super.onResume(); if (::site.isInitialized) site.onResume() }
    override fun onDestroy() {
        if (::site.isInitialized) {
            site.removeJavascriptInterface("TkpstTheme")
            (site.parent as? FrameLayout)?.removeView(site)
            site.destroy()
        }
        super.onDestroy()
    }
}
