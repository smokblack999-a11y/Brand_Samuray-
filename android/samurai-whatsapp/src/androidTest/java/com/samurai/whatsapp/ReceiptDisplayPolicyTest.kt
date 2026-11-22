package com.samurai.whatsapp

import org.junit.Assert.assertEquals
import org.junit.Test

class ReceiptDisplayPolicyTest {
    @Test
    fun alwaysSingleTickMasksOnlyPresentation() {
        val evidence = MessageStatusEvidence(
            MessageStatus.READ_CONFIRMED,
            "SAMURAI_MESSENGER",
            100L,
            110L
        )
        val result = ReceiptDisplayPolicy.present(
            evidence,
            ReceiptDisplayMode.ALWAYS_SINGLE_TICK
        )
        assertEquals("✓", result.icon)
        assertEquals("Отправлено · локальное отображение", result.label)
        assertEquals(MessageStatus.READ_CONFIRMED, result.verifiedStatus)
    }

    @Test
    fun standardModeShowsConfirmedDelivery() {
        val evidence = MessageStatusEvidence(
            MessageStatus.DELIVERED_TO_DEVICE,
            "SAMURAI_MESSENGER",
            100L,
            110L
        )
        val result = ReceiptDisplayPolicy.present(
            evidence,
            ReceiptDisplayMode.SHOW_VERIFIED_STATUS
        )
        assertEquals("✓✓", result.icon)
        assertEquals(MessageStatus.DELIVERED_TO_DEVICE, result.verifiedStatus)
    }

    @Test
    fun unknownStatusIsNotPresentedAsUnread() {
        val evidence = MessageStatusEvidence(
            MessageStatus.UNKNOWN,
            "NO_VERIFIED_SIGNAL",
            null,
            110L
        )
        val result = ReceiptDisplayPolicy.present(
            evidence,
            ReceiptDisplayMode.SHOW_VERIFIED_STATUS
        )
        assertEquals("?", result.icon)
        assertEquals("Статус неизвестен", result.label)
    }

    @Test
    fun singleTickDoesNotRewriteReadEvidence() {
        val evidence = MessageStatusEvidence(
            MessageStatus.MEDIA_PLAYED,
            "WHATSAPP_CLOUD_API",
            100L,
            110L
        )
        val result = ReceiptDisplayPolicy.present(
            evidence,
            ReceiptDisplayMode.ALWAYS_SINGLE_TICK
        )
        assertEquals("✓", result.icon)
        assertEquals(MessageStatus.MEDIA_PLAYED, result.verifiedStatus)
        assertEquals(100L, evidence.eventTimeMillis)
    }
}
