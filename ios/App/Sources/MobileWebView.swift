import SwiftUI
import UIKit
import WebKit

@MainActor
final class MobileBrowser: ObservableObject {
    weak var webView: WKWebView?
    func reload() { webView?.reload() }
}

struct MobileAppView: View {
    @EnvironmentObject private var settings: AppSettings
    @StateObject private var browser = MobileBrowser()
    @State private var ready = false
    @State private var failed = false
    @State private var dark = false

    var body: some View {
        ZStack {
            MobileWebView(settings: settings, browser: browser, ready: $ready, failed: $failed, dark: $dark)
                .ignoresSafeArea()
            if !ready || failed {
                VStack(spacing: 18) {
                    if failed {
                        Text("Не удалось открыть приложение")
                            .font(.headline)
                        Text("Проверьте соединение и попробуйте снова.")
                            .font(.subheadline)
                            .multilineTextAlignment(.center)
                        Button("Повторить") {
                            failed = false
                            ready = false
                            browser.reload()
                        }
                        .buttonStyle(.borderedProminent)
                    } else {
                        ProgressView()
                        Text("Загружаем ТКПСТ…").font(.subheadline)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(dark ? Color(red: 0.07, green: 0.08, blue: 0.06) : Color(red: 0.965, green: 0.973, blue: 0.945))
            }
        }
        .preferredColorScheme(dark ? .dark : .light)
    }
}

struct MobileWebView: UIViewRepresentable {
    static let origin = "https://tkpst-account.telling-math.workers.dev"
    static let host = "tkpst-account.telling-math.workers.dev"

    let settings: AppSettings
    let browser: MobileBrowser
    @Binding var ready: Bool
    @Binding var failed: Bool
    @Binding var dark: Bool

    func makeCoordinator() -> Coordinator { Coordinator(ready: $ready, failed: $failed, dark: $dark) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        let scripts = config.userContentController
        scripts.addUserScript(WKUserScript(source: diagnosticScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        scripts.addUserScript(WKUserScript(source: migrationScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        scripts.addUserScript(WKUserScript(source: appearanceScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        scripts.add(context.coordinator, name: "tkpstAppearance")

        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.isOpaque = false
        view.backgroundColor = UIColor(red: 0.965, green: 0.973, blue: 0.945, alpha: 1)
        view.allowsBackForwardNavigationGestures = true
        browser.webView = view
        view.load(URLRequest(url: URL(string: Self.origin + "/#/schedule")!))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.ready = $ready
        context.coordinator.failed = $failed
        context.coordinator.dark = $dark
        if settings.pendingRoute == "schedule" {
            DispatchQueue.main.async {
                view.evaluateJavaScript("location.hash = '#/schedule'", completionHandler: nil)
                settings.pendingRoute = nil
            }
        }
    }

    private func diagnosticScript() -> String {
        let info: [String: String] = [
            "platform": "iOS", "osVersion": UIDevice.current.systemVersion,
            "appVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
            "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown",
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: info),
              let literal = String(data: data, encoding: .utf8) else { return "" }
        return "window.__tkpstNativeInfo = \(literal);"
    }

    private func migrationScript() -> String {
        var old: [String: Any] = ["theme": settings.theme.rawValue]
        if let home = settings.home {
            old["home"] = ["label": home.label, "point": ["lat": home.point.lat, "lon": home.point.lon]]
        }
        let data = (try? JSONSerialization.data(withJSONObject: old)) ?? Data("{}".utf8)
        let literal = String(data: data, encoding: .utf8) ?? "{}"
        return """
        (() => { try {
          if (localStorage.getItem('tkpst_mobile_migrated_v1') !== null) return;
          const old = \(literal);
          if (localStorage.getItem('theme') === null) localStorage.setItem('theme', JSON.stringify(old.theme));
          if (old.home && localStorage.getItem('home') === null) localStorage.setItem('home', JSON.stringify(old.home));
          localStorage.setItem('tkpst_mobile_migrated_v1', '1');
        } catch (_) {} })();
        """
    }

    private var appearanceScript: String {
        """
        (() => {
          const report = () => window.webkit.messageHandlers.tkpstAppearance.postMessage(document.documentElement.dataset.appearance || 'light');
          new MutationObserver(report).observe(document.documentElement, { attributes: true, attributeFilter: ['data-appearance'] });
          report();
        })();
        """
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var ready: Binding<Bool>
        var failed: Binding<Bool>
        var dark: Binding<Bool>

        init(ready: Binding<Bool>, failed: Binding<Bool>, dark: Binding<Bool>) {
            self.ready = ready
            self.failed = failed
            self.dark = dark
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
            let parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
            let trusted = parts?.scheme == "https" && parts?.host == MobileWebView.host &&
                parts?.user == nil && parts?.password == nil && (parts?.port == nil || parts?.port == 443)
            if trusted {
                if action.targetFrame == nil { webView.load(action.request); decisionHandler(.cancel) }
                else { decisionHandler(.allow) }
            } else {
                if action.navigationType == .linkActivated && ["https", "http"].contains(url.scheme ?? "") {
                    UIApplication.shared.open(url)
                }
                decisionHandler(.cancel)
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            failed.wrappedValue = false
            ready.wrappedValue = true
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code == NSURLErrorCancelled { return }
            ready.wrappedValue = false
            failed.wrappedValue = true
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code == NSURLErrorCancelled { return }
            ready.wrappedValue = false
            failed.wrappedValue = true
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            ready.wrappedValue = false
            webView.reload()
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == MobileWebView.host else { return }
            dark.wrappedValue = (message.body as? String) == "dark"
        }
    }
}
