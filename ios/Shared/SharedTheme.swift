import Foundation
import UIKit

/// Цвета выбранной в приложении темы, общие для приложения и виджета (App Group).
/// Если общая память недоступна (сборка без подписи групп), виджет остаётся в системных цветах.
enum SharedTheme {
    private static let baseGroup = "group.ru.yami.tkpst"
    private static let key = "widget_colors"

    /// AltStore и SideStore при установке переименовывают группу и записывают новое имя
    /// в Info.plist приложения (ключ ALTAppGroups); расширение читает его у приложения-хозяина.
    static let groupId: String = {
        var bundles = [Bundle.main]
        let host = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
        if host.pathExtension == "app", let app = Bundle(url: host) { bundles.append(app) }
        for bundle in bundles {
            if let groups = bundle.object(forInfoDictionaryKey: "ALTAppGroups") as? [String],
               let match = groups.first(where: { $0.hasPrefix(baseGroup) }) {
                return match
            }
        }
        return baseGroup
    }()

    private static var defaults: UserDefaults? { UserDefaults(suiteName: groupId) }

    /// Сохраняет «фон, текст, приглушённый текст, акцент». Возвращает true, если цвета изменились.
    @discardableResult
    static func save(_ hex: [String]) -> Bool {
        guard hex.count == 4, hex.allSatisfy({ color($0) != nil }), let defaults else { return false }
        if defaults.stringArray(forKey: key) == hex { return false }
        defaults.set(hex, forKey: key)
        return true
    }

    /// Фон, текст, приглушённый текст и акцент темы или nil, если приложение их ещё не передало.
    static func load() -> [UIColor]? {
        guard let hex = defaults?.stringArray(forKey: key), hex.count == 4 else { return nil }
        let colors = hex.compactMap(color)
        return colors.count == 4 ? colors : nil
    }

    /// «#RRGGBB» -> цвет.
    static func color(_ hex: String) -> UIColor? {
        guard hex.count == 7, hex.hasPrefix("#"), let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        return UIColor(red: CGFloat((value >> 16) & 0xFF) / 255, green: CGFloat((value >> 8) & 0xFF) / 255,
                       blue: CGFloat(value & 0xFF) / 255, alpha: 1)
    }
}
