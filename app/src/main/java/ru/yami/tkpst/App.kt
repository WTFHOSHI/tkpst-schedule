package ru.yami.tkpst

import android.app.Application
import ru.yami.tkpst.data.ScheduleRepository
import ru.yami.tkpst.data.ScheduleSyncWorker
import ru.yami.tkpst.data.Settings

class App : Application() {
    val repository by lazy { ScheduleRepository(this) }
    val settings by lazy { Settings(this) }

    override fun onCreate() {
        super.onCreate()
        ScheduleSyncWorker.schedule(this)
    }
}
