package com.samuraios.app.core

import java.util.concurrent.CopyOnWriteArrayList

class SamuraiAuditLog(private val maxEntries: Int = 500) {
    private val entries = CopyOnWriteArrayList<SamuraiEvent>()

    fun append(event: SamuraiEvent) {
        entries += event
        while (entries.size > maxEntries) entries.removeAt(0)
    }

    fun snapshot(): List<SamuraiEvent> = entries.toList()
}
