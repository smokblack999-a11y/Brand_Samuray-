package com.samurai.whatsapp

import org.junit.Assert.assertEquals
import org.junit.Test

class MessageStatusReducerTest {
    @Test
    fun missingSignalsStayUnknown() {
        val result = MessageStatusReducer.reduce(emptyList())
        assertEquals(MessageStatus.UNKNOWN, result.status)
        assertEquals("Статус неизвестен", MessageStatusReducer.label(result.status))
    }

    @Test
    fun verifiedReadOutranksDelivered() {
        val result = MessageStatusReducer.reduce(
            listOf(
                MessageStatusEvidence(MessageStatus.DELIVERED_TO_DEVICE, "WHATSAPP_CLOUD_API", 100L, 110L),
                MessageStatusEvidence(MessageStatus.READ_CONFIRMED, "WHATSAPP_CLOUD_API", 120L, 130L)
            )
        )
        assertEquals(MessageStatus.READ_CONFIRMED, result.status)
        assertEquals(120L, result.eventTimeMillis)
    }

    @Test
    fun untrustedSourcesAreIgnored() {
        val result = MessageStatusReducer.reduce(
            listOf(
                MessageStatusEvidence(MessageStatus.READ_CONFIRMED, "GUESSED_FROM_ONLINE", 100L, 110L)
            )
        )
        assertEquals(MessageStatus.UNKNOWN, result.status)
    }

    @Test
    fun invalidTimestampsAreIgnored() {
        val result = MessageStatusReducer.reduce(
            listOf(
                MessageStatusEvidence(MessageStatus.DELIVERED_TO_DEVICE, "SAMURAI_MESSENGER", -1L, 0L)
            )
        )
        assertEquals(MessageStatus.UNKNOWN, result.status)
    }
}
