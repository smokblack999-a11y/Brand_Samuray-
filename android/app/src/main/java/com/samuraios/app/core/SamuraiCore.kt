package com.samuraios.app.core

import java.util.concurrent.ConcurrentHashMap

class SamuraiCore {
    val events = SamuraiEventBus()
    val audit = SamuraiAuditLog()

    private val modules = ConcurrentHashMap<String, SamuraiModule>()
    @Volatile private var running = false

    fun register(module: SamuraiModule): Boolean =
        modules.putIfAbsent(module.id, module) == null

    fun start() {
        if (running) return
        running = true
        publish("core.started")
        modules.values.forEach { module ->
            runCatching { module.start(this) }
                .onFailure {
                    publish("module.failed", mapOf(
                        "module" to module.id,
                        "error" to (it.message ?: it.javaClass.simpleName)
                    ))
                }
        }
    }

    fun stop() {
        if (!running) return
        modules.values.forEach { module ->
            runCatching { module.stop() }
        }
        publish("core.stopped")
        running = false
    }

    fun publish(type: String, payload: Map<String, String> = emptyMap()) {
        val event = SamuraiEvent(type = type, payload = payload)
        audit.append(event)
        events.publish(event)
    }

    fun moduleIds(): List<String> = modules.keys.sorted()
    fun isRunning(): Boolean = running
}
