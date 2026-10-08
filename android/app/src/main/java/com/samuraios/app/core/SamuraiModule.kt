package com.samuraios.app.core

interface SamuraiModule {
    val id: String
    fun start(core: SamuraiCore)
    fun stop()
}
