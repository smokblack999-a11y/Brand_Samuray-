package com.samuraios.app

import android.app.Application
import com.samuraios.app.core.SamuraiCore

class SamuraiApplication : Application() {
    lateinit var core: SamuraiCore
        private set

    override fun onCreate() {
        super.onCreate()
        core = SamuraiCore()
        core.start()
    }
}
