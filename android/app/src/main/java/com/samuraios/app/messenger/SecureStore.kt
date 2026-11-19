package com.samuraios.app.messenger

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureStore(context: Context) {
    private val prefs = context.getSharedPreferences("samurai_messenger_secure", Context.MODE_PRIVATE)
    private val alias = "samurai_messenger_master_v1"
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun key(): SecretKey {
        (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }

    @Synchronized
    fun put(name: String, value: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val packed = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        check(prefs.edit().putString(name, Base64.encodeToString(packed, Base64.NO_WRAP)).commit())
    }

    @Synchronized
    fun get(name: String): String? {
        val encoded = prefs.getString(name, null) ?: return null
        return try {
            val packed = Base64.decode(encoded, Base64.NO_WRAP)
            require(packed.size > 12)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, packed.copyOfRange(0, 12)))
            String(cipher.doFinal(packed.copyOfRange(12, packed.size)), Charsets.UTF_8)
        } catch (_: Exception) {
            prefs.edit().remove(name).commit()
            null
        }
    }

    fun remove(name: String) { prefs.edit().remove(name).apply() }
    fun clearSession() {
        prefs.edit().remove("access_token").remove("refresh_token").remove("user_id").remove("username").apply()
    }
    fun saveSession(access: String, refresh: String, userId: String, username: String) {
        put("access_token", access)
        put("refresh_token", refresh)
        put("user_id", userId)
        put("username", username)
    }
    fun accessToken() = get("access_token")
    fun refreshToken() = get("refresh_token")
    fun userId() = get("user_id")
    fun username() = get("username")
    fun saveConversationSecret(id: String, secret: String) = put("conversation_secret_" + id, secret)
    fun conversationSecret(id: String) = get("conversation_secret_" + id)
    fun readOutbox(): String = get("pending_outbox") ?: "[]"
    fun writeOutbox(value: String) = put("pending_outbox", value)
}
