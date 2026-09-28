import CoreLocation
import Foundation
import TkpstCore

/// Разовое определение местоположения.
@MainActor
final class Locator: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<LatLng?, Never>?
    private var authContinuation: CheckedContinuation<Void, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
    }

    var denied: Bool {
        let s = manager.authorizationStatus
        return s == .denied || s == .restricted
    }

    func current() async -> LatLng? {
        if manager.authorizationStatus == .notDetermined {
            await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
                authContinuation = c
                manager.requestWhenInUseAuthorization()
            }
        }
        if denied { return nil }
        return await withCheckedContinuation { c in
            continuation = c
            manager.requestLocation()
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            if manager.authorizationStatus != .notDetermined, let c = self.authContinuation {
                self.authContinuation = nil
                c.resume()
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let loc = locations.last.map { LatLng(lat: $0.coordinate.latitude, lon: $0.coordinate.longitude) }
        Task { @MainActor in
            self.continuation?.resume(returning: loc)
            self.continuation = nil
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            self.continuation?.resume(returning: nil)
            self.continuation = nil
        }
    }
}
