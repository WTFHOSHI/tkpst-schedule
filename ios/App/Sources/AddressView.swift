import SwiftUI
import TkpstCore

struct AddressView: View {
    @EnvironmentObject var settings: AppSettings
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [Geocoder.Place] = []
    @State private var searching = false
    @State private var error: String?
    @State private var gpsBusy = false
    @State private var gpsFound: Geocoder.Place?
    @State private var locator: Locator?

    var body: some View {
        List {
            if let home = settings.home {
                Section { Text("Сейчас: \(home.label)").foregroundStyle(Palette.muted) }
            }
            Section {
                HStack {
                    TextField("Улица и дом, например «Широтная 100»", text: $query)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    if searching { ProgressView() }
                }
                Button { locate() } label: {
                    HStack {
                        if gpsBusy { ProgressView() } else { Image(systemName: "location.fill") }
                        Text(gpsBusy ? "Определяю…" : "Я сейчас дома — определить по GPS")
                    }
                }
                .disabled(gpsBusy)
            }
            if let p = gpsFound {
                Section("Найдено по GPS") {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(p.title).font(.headline)
                        if !p.subtitle.isEmpty { Text(p.subtitle).font(.caption).foregroundStyle(Palette.muted) }
                    }
                    Button("Это мой дом") { save(p) }.fontWeight(.semibold)
                    Button("Отмена", role: .cancel) { gpsFound = nil }
                }
            }
            if let error {
                Section { Text(error).foregroundStyle(.red) }
            }
            if !results.isEmpty {
                Section("Подсказки") {
                    ForEach(results) { p in
                        Button { save(p) } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "mappin.circle.fill").foregroundStyle(Palette.primary)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(p.title).foregroundStyle(Palette.onSurface)
                                    if !p.subtitle.isEmpty { Text(p.subtitle).font(.caption).foregroundStyle(Palette.muted) }
                                }
                            }
                        }
                    }
                }
            }
            Section {
                Text("Адрес хранится только на телефоне. Поиск адресов — OpenStreetMap.")
                    .font(.caption).foregroundStyle(Palette.muted)
            }
        }
        .navigationTitle("Домашний адрес")
        .navigationBarTitleDisplayMode(.inline)
        // Подсказки с задержкой, чтобы не спамить сервер на каждую букву.
        .task(id: query) {
            error = nil
            let q = query.trimmingCharacters(in: .whitespaces)
            guard q.count >= 3 else { results = []; return }
            try? await Task.sleep(nanoseconds: 700_000_000)
            if Task.isCancelled { return }
            searching = true
            do {
                results = try await Geocoder.search(q)
                if results.isEmpty { error = "Ничего не нашлось. Попробуй «улица, дом»." }
            } catch {
                if !Task.isCancelled { self.error = "Не удалось найти адрес. Проверь интернет." }
            }
            searching = false
        }
    }

    private func locate() {
        gpsBusy = true
        error = nil
        let l = locator ?? Locator()
        locator = l
        Task {
            if let p = await l.current() {
                gpsFound = await Geocoder.reverse(p)
                    ?? Geocoder.Place(title: "Точка по GPS", subtitle: String(format: "%.5f, %.5f", p.lat, p.lon), point: p)
            } else if l.denied {
                error = "Нет доступа к геолокации. Разреши его в Настройках iPhone или введи адрес вручную."
            } else {
                error = "Не удалось определить местоположение. Попробуй на улице или у окна."
            }
            gpsBusy = false
        }
    }

    private func save(_ p: Geocoder.Place) {
        let label = p.title == "Точка по GPS" ? "\(p.title) (\(p.subtitle))" : p.title
        settings.home = HomeAddress(label: label, point: p.point)
        dismiss()
    }
}

struct SettingsView: View {
    @EnvironmentObject var settings: AppSettings
    @State private var cleared = false

    var body: some View {
        Form {
            Section("Тема") {
                Picker("Тема", selection: $settings.theme) {
                    ForEach(ThemeMode.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }
            Section {
                Text("Группа: ИС-25-3С (ТКПСТ, Луначарского)")
                Button(cleared ? "Очищено" : "Очистить сохранённое расписание") {
                    Task { await ScheduleRepository.shared.clearCache(); cleared = true }
                }
                .disabled(cleared)
            } header: { Text("Расписание") } footer: {
                Text("Время везде считается по Тюмени (UTC+5). Звонки — по официальному расписанию звонков, предметы, кабинеты и преподаватели — из OpenScheduleApi.")
            }
            Section {
                Text("Домашний адрес: \(settings.home?.label ?? "не указан")")
                NavigationLink(value: Route.address) {
                    Text(settings.home == nil ? "Указать домашний адрес" : "Изменить домашний адрес")
                }
            } header: { Text("Автобусы") } footer: {
                Text("Колледж: Луначарского, 19. Данные об автобусах — Тюменьгортранс (онлайн по GPS).")
            }
        }
        .navigationTitle("Настройки")
        .navigationBarTitleDisplayMode(.inline)
    }
}
