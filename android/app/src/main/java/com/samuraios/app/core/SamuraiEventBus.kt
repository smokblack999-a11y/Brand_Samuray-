package com.samuraios.app.core

import java.util.concurrent.CopyOnWriteArrayList

class SamuraiEventBus {
    private val listeners = CopyOnWriteArrayList<(SamuraiEvent) -> Unit>()

    fun subscribe(listener: (SamuraiEvent) -> Unit): () -> Unit {
        listeners += listener
        return { listeners -= listener }
    }

    fun publish(event: SamuraiEvent) {
        listeners.forEach { listener ->
            runCatching { listener(event) }
        }
    }

    fun clear() {
        listeners.clear()
    }
}
