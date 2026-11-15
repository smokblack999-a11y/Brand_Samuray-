package com.samurai.whatsapp

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MessageTimelineTest {
    private val context: Context
        get() = ApplicationProvider.getApplicationContext()

    @Before
    fun setUp() {
        MessageTimeline.clear(context)
    }

    @After
    fun tearDown() {
        MessageTimeline.clear(context)
    }

    @Test
    fun recordsNotificationWithSourceAndSeparateObservedTime() {
        val sourceTime = 1_800_000_000_000L
        MessageTimeline.recordNotificationCaptured(
            context,
            "com.whatsapp",
            "notification-key",
            sourceTime
        )

        val event = MessageTimeline.list(context).single()
        assertEquals("INCOMING_NOTIFICATION_CAPTURED", event.eventType)
        assertEquals("ANDROID_NOTIFICATION", event.source)
        assertEquals(sourceTime, event.eventTime)
        assertTrue(event.observedAt >= sourceTime)
        assertEquals("WhatsApp notification captured", event.summary)
    }

    @Test
    fun doesNotInventReadOrPresenceEvents() {
        MessageTimeline.recordNotificationCaptured(
            context,
            "com.whatsapp",
            "notification-key",
            System.currentTimeMillis()
        )

        val eventTypes = MessageTimeline.list(context).map { it.eventType }
        assertTrue(eventTypes.contains("INCOMING_NOTIFICATION_CAPTURED"))
        assertFalse(eventTypes.contains("READ_CONFIRMED"))
        assertFalse(eventTypes.contains("PRESENCE_ONLINE_OBSERVED"))
    }

    @Test
    fun missingSourceEventTimeRemainsNull() {
        MessageTimeline.append(
            context,
            eventType = "CHAT_EXPORT_IMPORTED",
            source = "USER_SELECTED_CHAT_EXPORT",
            reference = "source-hash",
            eventTime = null,
            summary = "Import completed",
            stableId = "chat-export:source-hash"
        )

        val event = MessageTimeline.list(context).single()
        assertNull(event.eventTime)
        assertTrue(event.observedAt > 0)
    }

    @Test
    fun stableNotificationReferenceDeduplicatesEvents() {
        repeat(2) {
            MessageTimeline.recordNotificationCaptured(
                context,
                "com.whatsapp",
                "same-key",
                1_800_000_000_000L
            )
        }
        assertEquals(1, MessageTimeline.list(context).size)
    }

    @Test
    fun eventPayloadIsEncryptedAtRest() {
        MessageTimeline.append(
            context,
            eventType = "CHAT_EXPORT_IMPORTED",
            source = "USER_SELECTED_CHAT_EXPORT",
            reference = "private-reference-198",
            eventTime = null,
            summary = "private timeline marker 198"
        )

        val payloads = MessageTimeline.encryptedValuesForTest(context)
        assertEquals(1, payloads.size)
        assertFalse(payloads.single().contains("private timeline marker 198"))
        assertFalse(payloads.single().contains("private-reference-198"))
    }

    @Test
    fun rejectsUntrustedEventTypesAndSources() {
        val badType = runCatching {
            MessageTimeline.append(
                context, "USER_WAS_READ", "ANDROID_NOTIFICATION",
                "ref", null, "Not a supported evidence event"
            )
        }
        val badSource = runCatching {
            MessageTimeline.append(
                context, "READ_CONFIRMED", "GUESS",
                "ref", null, "Unverified source"
            )
        }
        assertTrue(badType.isFailure)
        assertTrue(badSource.isFailure)
        assertTrue(MessageTimeline.list(context).isEmpty())
    }
}
