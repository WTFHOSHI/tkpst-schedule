import BackgroundTasks
import Foundation
import TkpstCore

/// Фоновая синхронизация расписания. iOS сама решает, когда запускать (обычно раз в несколько часов).
enum BackgroundSync {
    static let taskId = "ru.yami.tkpst.sync"

    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: taskId, using: nil) { task in
            guard let task = task as? BGAppRefreshTask else { return }
            schedule()
            let work = Task {
                let today = Date()
                let changes = await ScheduleRepository.shared.prefetch(ScheduleRepository.weeksToSync(today), today: today)
                if let changes { ScheduleNotifier.notify(changes) }
                task.setTaskCompleted(success: changes != nil)
            }
            task.expirationHandler = { work.cancel() }
        }
    }

    static func schedule() {
        let req = BGAppRefreshTaskRequest(identifier: taskId)
        req.earliestBeginDate = Date(timeIntervalSinceNow: 3 * 3600)
        try? BGTaskScheduler.shared.submit(req)
    }
}
