package ru.yami.tkpst

import android.app.Application
import ru.yami.tkpst.data.OverridesRepository
import ru.yami.tkpst.data.ScheduleRepository
import ru.yami.tkpst.data.ScheduleSyncWorker
import ru.yami.tkpst.data.Settings
import ru.yami.tkpst.data.transit.TransitRepository

class App : Application() {
    val repository by lazy { ScheduleRepository(this) }
    val settings by lazy { Settings(this) }
    val transit by lazy { TransitRepository(this) }
    val overrides by lazy { OverridesRepository(this) }

    override fun onCreate() {
        super.onCreate()
        overrides // загрузить сохранённые изменения админа до первого экрана
        ScheduleSyncWorker.schedule(this)
    }
}
