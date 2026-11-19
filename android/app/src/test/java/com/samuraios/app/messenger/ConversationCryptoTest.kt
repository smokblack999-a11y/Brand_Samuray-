package com.samuraios.app.messenger

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ConversationCryptoTest {
    private val conversation = "9b34c6f2-86ea-48f4-ae75-65d5e8ad1234"
    private val secret = "correct horse battery"

    @Test
    fun encryptDecryptRoundTrip() {
        val encrypted = ConversationCrypto.encrypt(conversation, secret, "Проверка SAMURAI")
        val decoded = ConversationCrypto.decrypt(conversation, secret, encrypted.ciphertext, encrypted.nonce)
        assertEquals("Проверка SAMURAI", decoded)
    }

    @Test
    fun randomNonceChangesCiphertextForSameMessage() {
        val first = ConversationCrypto.encrypt(conversation, secret, "same message")
        val second = ConversationCrypto.encrypt(conversation, secret, "same message")
        assertNotEquals(first.nonce, second.nonce)
        assertNotEquals(first.ciphertext, second.ciphertext)
    }

    @Test
    fun wrongSecretCannotDecrypt() {
        val encrypted = ConversationCrypto.encrypt(conversation, secret, "private")
        assertThrows(Exception::class.java) {
            ConversationCrypto.decrypt(conversation, "different shared secret", encrypted.ciphertext, encrypted.nonce)
        }
    }

    @Test
    fun messageCannotBeMovedToAnotherConversation() {
        val encrypted = ConversationCrypto.encrypt(conversation, secret, "bound to conversation")
        assertThrows(Exception::class.java) {
            ConversationCrypto.decrypt("other-conversation-id", secret, encrypted.ciphertext, encrypted.nonce)
        }
    }

    @Test
    fun passphraseMustHaveMinimumLength() {
        assertThrows(IllegalArgumentException::class.java) {
            ConversationCrypto.encrypt(conversation, "short", "private")
        }
    }
}
