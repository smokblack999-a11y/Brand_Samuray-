package com.samurai.whatsapp

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal data class ArchivedNotification(
    val packageName: String,
    val title: String,
    val body: String,
    val timestamp: Long
)

internal object NotificationArchive {
    private const val PREFS = "samurai_notification_archive"
    private const val KEY_ALIAS = "samurai_whatsapp_archive_v1"
    private const val ENABLED_KEY = "archive_enabled"
    private const val MAX_ENTRIES = 200
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val IV_LENGTH_BYTES = 12
    private const val TAG_LENGTH_BITS = 128

    fun isEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(ENABLED_KEY, true)

    fun setEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(ENABLED_KEY, enabled).apply()
    }

    @Synchronized
    fun save(context: Context, packageName: String, title: String, body: String, timestamp: Long) {
        if (!isEnabled(context)) return
        val json = JSONObject()
            .put("package", packageName)
            .put("title", title)
            .put("body", body)
            .put("timestamp", timestamp)
            .toString()
        val encrypted = encrypt(json)
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val id = "entry_${timestamp}_${UUID.randomUUID()}"
        val all = prefs.all.keys.filter { it.startsWith("entry_") }.sorted()
        prefs.edit().putString(id, encrypted).apply()
        if (all.size >= MAX_ENTRIES) {
            prefs.edit().also { editor ->
                all.take(all.size - MAX_ENTRIES + 1).forEach(editor::remove)
            }.apply()
        }
    }

    @Synchronized
    fun readAll(context: Context): List<ArchivedNotification> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return prefs.all.entries
            .filter { it.key.startsWith("entry_") }
            .sortedBy { it.key }
            .mapNotNull { entry ->
                runCatching {
                    val encrypted = entry.value as? String ?: return@runCatching null
                    val json = JSONObject(decrypt(encrypted))
                    ArchivedNotification(
                        packageName = json.optString("package"),
                        title = json.optString("title"),
                        body = json.optString("body"),
                        timestamp = json.optLong("timestamp")
                    )
                }.getOrNull()
            }
            .asReversed()
    }

    fun clear(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val enabled = prefs.getBoolean(ENABLED_KEY, true)
        prefs.edit().clear().putBoolean(ENABLED_KEY, enabled).apply()
    }

    private fun encrypt(plainText: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(plainText.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
            Base64.encodeToString(encrypted, Base64.NO_WRAP)
    }

    private fun decrypt(payload: String): String {
        val parts = payload.split(":", limit = 2)
        require(parts.size == 2) { "Invalid encrypted record" }
        val iv = Base64.decode(parts[0], Base64.NO_WRAP)
        val encrypted = Base64.decode(parts[1], Base64.NO_WRAP)
        require(iv.size == IV_LENGTH_BYTES) { "Invalid IV" }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            getOrCreateKey(),
            GCMParameterSpec(TAG_LENGTH_BITS, iv)
        )
        return String(cipher.doFinal(encrypted), Charsets.UTF_8)
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setKeySize(256)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }
}
