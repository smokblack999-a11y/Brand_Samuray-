package com.samurai.whatsapp

/**
 * Evidence-based message status model.
 *
 * This model is for SAMURAI-owned messaging integrations and official
 * Business Platform webhooks. It does not alter personal WhatsApp receipts.
 * Missing signals remain UNKNOWN; observation time is not server event time.
 */
internal enum class MessageStatus {
    UNKNOWN,
    ACCEPTED_BY_SERVER,
    DELIVERED_TO_DEVICE,
    READ_CONFIRMED,
    MEDIA_PLAYED
}

internal data class MessageStatusEvidence(
    val status: MessageStatus,
    val source: String,
    val eventTimeMillis: Long?,
    val observedAtMillis: Long
)

internal object MessageStatusReducer {
    private val allowedSources = setOf(
        "WHATSAPP_CLOUD_API",
        "LAB_WEB_SESSION",
        "SAMURAI_MESSENGER"
    )

    fun reduce(events: List<MessageStatusEvidence>): MessageStatusEvidence {
        val valid = events.filter {
            it.source in allowedSources &&
                it.observedAtMillis > 0L &&
                (it.eventTimeMillis == null || it.eventTimeMillis > 0L)
        }
        if (valid.isEmpty()) {
            return MessageStatusEvidence(
                MessageStatus.UNKNOWN,
                "NO_VERIFIED_SIGNAL",
                null,
                System.currentTimeMillis()
            )
        }

        // A higher confirmed state wins. Do not infer delivery/read from elapsed time.
        val rank = mapOf(
            MessageStatus.UNKNOWN to 0,
            MessageStatus.ACCEPTED_BY_SERVER to 1,
            MessageStatus.DELIVERED_TO_DEVICE to 2,
            MessageStatus.READ_CONFIRMED to 3,
            MessageStatus.MEDIA_PLAYED to 4
        )
        return valid.maxWithOrNull(
            compareBy<MessageStatusEvidence> { rank[it.status] ?: 0 }
                .thenBy { it.eventTimeMillis ?: it.observedAtMillis }
        )!!
    }

    /** UI label deliberately distinguishes unknown from not delivered/unread. */
    fun label(status: MessageStatus): String = when (status) {
        MessageStatus.UNKNOWN -> "Статус неизвестен"
        MessageStatus.ACCEPTED_BY_SERVER -> "Принято сервером"
        MessageStatus.DELIVERED_TO_DEVICE -> "Доставлено на устройство"
        MessageStatus.READ_CONFIRMED -> "Прочитано (подтверждено)"
        MessageStatus.MEDIA_PLAYED -> "Медиа воспроизведено"
    }
}
