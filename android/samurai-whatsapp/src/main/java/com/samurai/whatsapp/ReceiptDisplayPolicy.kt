package com.samurai.whatsapp

/**
 * Local presentation policy for SAMURAI-owned message views.
 *
 * ALWAYS_SINGLE_TICK masks the visual indicator in this app only. It does not
 * suppress WhatsApp network receipts, change delivery, or affect what another
 * participant sees. The underlying evidence is retained unchanged.
 */
internal enum class ReceiptDisplayMode {
    SHOW_VERIFIED_STATUS,
    ALWAYS_SINGLE_TICK
}

internal data class ReceiptPresentation(
    val icon: String,
    val label: String,
    val verifiedStatus: MessageStatus
)

internal object ReceiptDisplayPolicy {
    fun present(
        evidence: MessageStatusEvidence,
        mode: ReceiptDisplayMode
    ): ReceiptPresentation = when (mode) {
        ReceiptDisplayMode.SHOW_VERIFIED_STATUS -> ReceiptPresentation(
            icon = when (evidence.status) {
                MessageStatus.UNKNOWN -> "?"
                MessageStatus.ACCEPTED_BY_SERVER -> "✓"
                MessageStatus.DELIVERED_TO_DEVICE -> "✓✓"
                MessageStatus.READ_CONFIRMED, MessageStatus.MEDIA_PLAYED -> "✓✓"
            },
            label = MessageStatusReducer.label(evidence.status),
            verifiedStatus = evidence.status
        )
        ReceiptDisplayMode.ALWAYS_SINGLE_TICK -> ReceiptPresentation(
            icon = "✓",
            label = "Отправлено · локальное отображение",
            verifiedStatus = evidence.status
        )
    }
}
