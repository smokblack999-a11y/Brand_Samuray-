package com.samuraios.app.core

data class SamuraiEvent(
    val type: String,
    val timestampMs: Long = System.currentTimeMillis(),
    val payload: Map<String, String> = emptyMap()
)
