import Foundation

// ---------- Ответы api.tgt72.ru (Тюменьгортранс) ----------

public struct TgtList<T: Decodable>: Decodable {
    public let objects: [T]
    enum CodingKeys: String, CodingKey { case objects }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        objects = (try? c.decode([T].self, forKey: .objects)) ?? []
    }
}

public struct TgtCheckpoint: Decodable {
    public let id: Int
    public let name: String?
    public let description: String?
    public let coordinate: [Double]?
}

public struct TgtRoute: Decodable {
    public let id: Int
    public let name: String?
    public let outdated: Bool?
    public let dates: [String]?
}

public struct TgtRouteCheckpoint: Decodable {
    public let checkpoint_id: Int
    public let forward: Bool?
    public let order: Int?
    public let primary: Bool?
}

public struct TgtPredictionInfo: Decodable {
    public let time: String?
    public let precise: Bool?
}

public struct TgtPredictionItem: Decodable {
    public let prediction: TgtPredictionInfo?
}

public struct TgtPrediction: Decodable {
    public let route_id: Int
    public let order: [TgtPredictionItem]?
}

public struct TgtTimes: Decodable {
    public let is_forward: Bool?
    public let times: [String]?
}

// ---------- Компактная сеть, сохраняется на телефоне раз в день ----------

public struct Stop: Codable, Hashable, Sendable {
    public let id: Int
    public let name: String
    public let desc: String
    public let lat: Double
    public let lon: Double
    public init(id: Int, name: String, desc: String, lat: Double, lon: Double) {
        self.id = id; self.name = name; self.desc = desc; self.lat = lat; self.lon = lon
    }
}

/// Одно направление одного маршрута — упорядоченный список остановок.
public struct Pattern: Codable, Sendable {
    public let routeId: Int
    public let routeName: String
    public let forward: Bool
    public let stops: [Int]
    public init(routeId: Int, routeName: String, forward: Bool, stops: [Int]) {
        self.routeId = routeId; self.routeName = routeName; self.forward = forward; self.stops = stops
    }
}

public struct NetworkData: Codable, Sendable {
    public let date: String
    public let stops: [Stop]
    public let patterns: [Pattern]
    public init(date: String, stops: [Stop], patterns: [Pattern]) {
        self.date = date; self.stops = stops; self.patterns = patterns
    }
}

public struct LatLng: Codable, Equatable, Hashable, Sendable {
    public let lat: Double
    public let lon: Double
    public init(lat: Double, lon: Double) { self.lat = lat; self.lon = lon }
}

public enum Geo {
    /// Колледж, ул. Луначарского, 19 (координаты из OpenStreetMap).
    public static let college = LatLng(lat: 57.1647166, lon: 65.5103316)
    public static let collegeLabel = "Колледж, Луначарского, 19"

    static let walkMPerMin = 75.0
    static let detour = 1.25

    public static func distanceM(_ aLat: Double, _ aLon: Double, _ bLat: Double, _ bLon: Double) -> Double {
        let r = 6_371_000.0
        let dLat = (bLat - aLat) * .pi / 180
        let dLon = (bLon - aLon) * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2) +
            cos(aLat * .pi / 180) * cos(bLat * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * r * atan2(sqrt(h), sqrt(1 - h))
    }

    public static func distanceM(_ a: LatLng, _ b: Stop) -> Double { distanceM(a.lat, a.lon, b.lat, b.lon) }
    public static func distanceM(_ a: Stop, _ b: Stop) -> Double { distanceM(a.lat, a.lon, b.lat, b.lon) }

    public static func walkM(_ straight: Double) -> Double { straight * detour }
    public static func walkMin(_ straight: Double) -> Double { walkM(straight) / walkMPerMin }
}
