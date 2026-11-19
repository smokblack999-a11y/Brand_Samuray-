package com.samuraios.app.messenger

import android.util.Base64
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

data class EncryptedMessage(val ciphertext: String, val nonce: String)

object ConversationCrypto {
    private const val ITERATIONS = 180_000
    private const val KEY_BITS = 256
    private val random = SecureRandom()

    private fun deriveKey(conversationId: String, passphrase: CharArray): ByteArray {
        require(passphrase.size >= 12) { "Код шифрования должен содержать минимум 12 символов" }
        val spec = PBEKeySpec(passphrase, conversationId.toByteArray(Charsets.UTF_8), ITERATIONS, KEY_BITS)
        return try {
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
        }
    }

    fun encrypt(conversationId: String, passphrase: String, plaintext: String): EncryptedMessage {
        val nonceBytes = ByteArray(12).also(random::nextBytes)
        val key = SecretKeySpec(deriveKey(conversationId, passphrase.toCharArray()), "AES")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, nonceBytes))
        cipher.updateAAD(conversationId.toByteArray(Charsets.UTF_8))
        val encrypted = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        return EncryptedMessage(
            Base64.encodeToString(encrypted, Base64.NO_WRAP),
            Base64.encodeToString(nonceBytes, Base64.NO_WRAP)
        )
    }

    fun decrypt(conversationId: String, passphrase: String, ciphertext: String, nonce: String): String {
        val key = SecretKeySpec(deriveKey(conversationId, passphrase.toCharArray()), "AES")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, Base64.decode(nonce, Base64.NO_WRAP)))
        cipher.updateAAD(conversationId.toByteArray(Charsets.UTF_8))
        return String(cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)), Charsets.UTF_8)
    }
}
