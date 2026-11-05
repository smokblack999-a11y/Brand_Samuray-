package com.samurai.telegram.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TelegramModelsTest {
    @Test fun idsRejectBlankValues() {
        assertFailsWith<IllegalArgumentException> { ChatId(" ") }
        assertFailsWith<IllegalArgumentException> { AccountId("") }
        assertFailsWith<IllegalArgumentException> { MessageId("\n") }
    }
    @Test fun chatRejectsInvalidValues() {
        assertFailsWith<IllegalArgumentException> { TelegramChat(ChatId("123"), "General", unreadCount = -1) }
        assertFailsWith<IllegalArgumentException> { TelegramChat(ChatId("123"), " ") }
    }
    @Test fun configDoesNotPrintSecrets() {
        val config = TelegramCoreConfig(12345, "secret-api-hash", "/private/tdlib", "/private/files", "super-secret-key".toByteArray())
        val rendered = config.toString()
        assertTrue("REDACTED" in rendered)
        assertFalse("secret-api-hash" in rendered)
        assertFalse("super-secret-key" in rendered)
        assertFalse("/private/tdlib" in rendered)
    }
    @Test fun transferProgressValidatesBounds() {
        val event = TelegramEvent.TransferProgress("upload-1", 50, 100)
        assertEquals(50L, event.completedBytes)
        assertFailsWith<IllegalArgumentException> { TelegramEvent.TransferProgress("upload-2", 101, 100) }
    }
}
