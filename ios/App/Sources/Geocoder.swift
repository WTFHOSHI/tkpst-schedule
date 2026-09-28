import Foundation
import TkpstCore

/// Поиск адресов через OpenStreetMap (Nominatim), только в пределах Тюмени.
enum Geocoder {
    static let base = "https://nominatim.openstreetmap.org"
    /// Границы Тюмени с окрестностями: запад, север, восток, юг.
    static let viewbox = "65.25,57.28,65.80,57.02"

    struct Place: Identifiable, Equatable {
        let title: String
        let subtitle: String
        let point: LatLng
        var id: String { "\(title)|\(subtitle)|\(point.lat),\(point.lon)" }
    }

    private struct NAddress: Decodable {
        let road: String?
        let house_number: String?
        let suburb: String?
        let city_district: String?
        let neighbourhood: String?
        let city: String?
        let town: String?
        let village: String?
    }

    private struct NPlace: Decodable {
        let lat: String
        let lon: String
        let name: String?
        let display_name: String?
        let address: NAddress?

        var place: Place? {
            guard let la = Double(lat), let lo = Double(lon) else { return nil }
            let street = [address?.road, address?.house_number].compactMap { $0 }.joined(separator: ", ")
            let title: String
            if !street.isEmpty { title = street }
            else if let n = name, !n.isEmpty { title = n }
            else { title = String((display_name ?? "").split(separator: ",").first ?? "") }
            var sub: [String] = []
            if let s = address?.suburb ?? address?.neighbourhood ?? address?.city_district { sub.append(s) }
            if let c = address?.city ?? address?.town ?? address?.village, !sub.contains(c) { sub.append(c) }
            return Place(title: title, subtitle: sub.joined(separator: ", "), point: LatLng(lat: la, lon: lo))
        }
    }

    static func search(_ query: String) async throws -> [Place] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 3 else { return [] }
        let full = q.range(of: "тюмен", options: .caseInsensitive) != nil ? q : "\(q), Тюмень"
        let url = "\(base)/search?format=jsonv2&addressdetails=1&limit=6&accept-language=ru" +
            "&countrycodes=ru&viewbox=\(viewbox)&bounded=1&q=\(Http.enc(full))"
        let list = try JSONDecoder().decode([NPlace].self, from: try await Http.get(url))
        var seen = Set<String>()
        return list.compactMap { $0.place }.filter { seen.insert($0.title + $0.subtitle).inserted }
    }

    static func reverse(_ p: LatLng) async -> Place? {
        let url = "\(base)/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=ru&lat=\(p.lat)&lon=\(p.lon)"
        guard let data = try? await Http.get(url), let n = try? JSONDecoder().decode(NPlace.self, from: data),
              let place = n.place else { return nil }
        return Place(title: place.title, subtitle: place.subtitle, point: p)
    }
}
