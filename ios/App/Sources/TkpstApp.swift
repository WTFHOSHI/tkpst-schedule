import SwiftUI
import TkpstCore
import UserNotifications

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        BackgroundSync.register()
        BackgroundSync.schedule()
        UNUserNotificationCenter.current().delegate = self
        ScheduleNotifier.requestPermissionOnce()
        return true
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        Task { @MainActor in AppSettings.shared.pendingRoute = "schedule" }
        completionHandler()
    }
}

enum Route: Hashable { case schedule, buses, address, settings }

@main
struct TkpstApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var settings = AppSettings.shared
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(settings)
                .preferredColorScheme(settings.theme.colorScheme)
                .tint(Palette.primary)
        }
        .onChange(of: phase) { p in
            if p == .background { BackgroundSync.schedule() }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var settings: AppSettings
    @State private var path: [Route] = []

    var body: some View {
        NavigationStack(path: $path) {
            HomeView()
                .navigationDestination(for: Route.self) { r in
                    switch r {
                    case .schedule: ScheduleView()
                    case .buses: BusView()
                    case .address: AddressView()
                    case .settings: SettingsView()
                    }
                }
        }
        .onChange(of: settings.pendingRoute) { r in
            if r == "schedule" {
                path = [.schedule]
                settings.pendingRoute = nil
            }
        }
    }
}

struct HomeView: View {
    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { ctx in
            VStack(spacing: 16) {
                NavigationLink(value: Route.schedule) {
                    BigButton(title: "Расписание", subtitle: "Пары группы ИС-25-3С", icon: "calendar",
                              fill: Palette.primaryContainer, fg: Palette.onPrimaryContainer)
                }
                NavigationLink(value: Route.buses) {
                    BigButton(title: "Автобусы", subtitle: "Дом ↔ Луначарского, 19 · онлайн", icon: "bus.fill",
                              fill: Palette.secondaryContainer, fg: Palette.onSecondaryContainer)
                }
            }
            .buttonStyle(.plain)
            .padding(16)
            .background(Palette.background.ignoresSafeArea())
            .navigationTitle("ТКПСТ")
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text("ТКПСТ").font(.headline)
                        Text("Тюмень · " + Tyumen.format(ctx.date, "EEEE, d MMMM · HH:mm"))
                            .font(.caption).foregroundStyle(Palette.muted)
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    NavigationLink(value: Route.settings) { Image(systemName: "gearshape") }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

private struct BigButton: View {
    let title: String
    let subtitle: String
    let icon: String
    let fill: Color
    let fg: Color
    var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 28).fill(fill)
            Image(systemName: icon)
                .font(.system(size: 30))
                .frame(width: 64, height: 64)
                .background(Circle().fill(fg.opacity(0.12)))
                .padding(24)
            VStack(alignment: .leading, spacing: 4) {
                Spacer()
                Text(title).font(.largeTitle.weight(.bold))
                Text(subtitle).font(.body)
            }
            .padding(24)
        }
        .foregroundStyle(fg)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
    }
}
