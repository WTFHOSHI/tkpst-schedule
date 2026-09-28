import SwiftUI
import UIKit

private extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

private func dyn(_ light: UInt32, _ dark: UInt32) -> Color {
    Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
}

/// Зелёная гамма в духе листа «Расписание звонков», светлая и тёмная.
enum Palette {
    static let primary = dyn(0x4F6F2F, 0xB2D38F)
    static let onPrimary = dyn(0xFFFFFF, 0x223600)
    static let primaryContainer = dyn(0xD6E8C2, 0x384F1A)
    static let onPrimaryContainer = dyn(0x142000, 0xD6E8C2)
    static let secondaryContainer = dyn(0xE2EAD6, 0x3F4837)
    static let onSecondaryContainer = dyn(0x181E12, 0xDDE6D0)
    static let tertiary = dyn(0x8A5A1F, 0xF1BD7E)
    static let tertiaryContainer = dyn(0xFBE3C6, 0x6A430C)
    static let onTertiaryContainer = dyn(0x2D1600, 0xFBE3C6)
    static let background = dyn(0xF6F8F1, 0x121410)
    static let card = dyn(0xF0F3EA, 0x1A1C17)
    static let cardHigh = dyn(0xE5E8DE, 0x292B25)
    static let onSurface = dyn(0x1A1C17, 0xE3E3DB)
    static let muted = dyn(0x44483E, 0xC5C8BA)
    static let outline = dyn(0xC5C8BA, 0x44483E)
}

struct CardStyle: ViewModifier {
    var fill: Color = Palette.card
    var stroke: Color? = Palette.outline
    var lineWidth: CGFloat = 1
    var radius: CGFloat = 20
    func body(content: Content) -> some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: radius).fill(fill))
            .overlay {
                if let stroke { RoundedRectangle(cornerRadius: radius).stroke(stroke, lineWidth: lineWidth) }
            }
    }
}

extension View {
    func card(fill: Color = Palette.card, stroke: Color? = Palette.outline, lineWidth: CGFloat = 1, radius: CGFloat = 20) -> some View {
        modifier(CardStyle(fill: fill, stroke: stroke, lineWidth: lineWidth, radius: radius))
    }
}

struct ProgressBar: View {
    let value: Double
    var color: Color = Palette.primary
    var height: CGFloat = 6
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.cardHigh)
                Capsule().fill(color).frame(width: g.size.width * min(max(value, 0), 1))
            }
        }
        .frame(height: height)
    }
}

struct Badge: View {
    let text: String
    var fill: Color = Palette.tertiaryContainer
    var fg: Color = Palette.onTertiaryContainer
    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(RoundedRectangle(cornerRadius: 6).fill(fill))
            .foregroundStyle(fg)
    }
}

struct RouteBadge: View {
    let name: String
    var highlighted = true
    var body: some View {
        Text(name)
            .font(.subheadline.weight(.bold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(RoundedRectangle(cornerRadius: 8).fill(highlighted ? Palette.primary : Palette.cardHigh))
            .foregroundStyle(highlighted ? Palette.onPrimary : Palette.muted)
    }
}

struct CenterMessage: View {
    let title: String
    let text: String
    var action: String? = nil
    var onAction: () -> Void = {}
    var body: some View {
        VStack(spacing: 10) {
            Text(title).font(.title2.weight(.semibold)).multilineTextAlignment(.center)
            Text(text).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
            if let action {
                Button(action, action: onAction).buttonStyle(.borderedProminent).padding(.top, 4)
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
