import Foundation
import SwiftUI
import TkpstCore

enum ThemeMode: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var label: String {
        switch self {
        case .system: return "Как в системе"
        case .light: return "Светлая"
        case .dark: return "Тёмная"
        }
    }
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

struct HomeAddress: Codable, Equatable {
    let label: String
    let point: LatLng
}

/// Настройки приложения. Хранятся только на телефоне.
@MainActor
final class AppSettings: ObservableObject {
    static let shared = AppSettings()
    private let d = UserDefaults.standard

    @Published var theme: ThemeMode {
        didSet { d.set(theme.rawValue, forKey: "theme") }
    }

    @Published var home: HomeAddress? {
        didSet {
            if let home, let data = try? JSONEncoder().encode(home) { d.set(data, forKey: "home") }
            else { d.removeObject(forKey: "home") }
        }
    }

    /// Экран, который нужно открыть по нажатию на уведомление.
    @Published var pendingRoute: String?

    private init() {
        theme = ThemeMode(rawValue: d.string(forKey: "theme") ?? "") ?? .system
        home = d.data(forKey: "home").flatMap { try? JSONDecoder().decode(HomeAddress.self, from: $0) }
    }
}
