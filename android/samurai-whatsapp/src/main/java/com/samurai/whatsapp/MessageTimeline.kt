package com.samurai.whatsapp

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal data class TimelineEvent(
    val id: String,
    val eventType: String,
    val source: String,
    val reference: String,
    val eventTime: Long?,
    val observedAt: Long,
    val summary: String
) {
    companion object {
        fun fromJson(value: String): TimelineEvent {
            val json = JSONObject(value)
            val eventTime = json.opt("eventTime").let { raw ->
                if (raw == null || raw == JSONObject.NULL) null else json.getLong("eventTime")
            }
            return TimelineEvent(
                id = json.getString("id"),
                eventType = json.getString("eventType"),
                source = json.getString("source"),
                reference = json.getString("reference"),
                eventTime = eventTime,
                observedAt = json.getLong("observedAt"),
                summary = json.getString("summary")
            )
        }
    }
}

/**
 * Encrypted evidence ledger. It records only events supplied by a real source;
 * missing events are never synthesized as unread, offline, or undelivered.
 */
internal object MessageTimeline {
    private const val PREFS = "samurai_message_timeline"
    private const val KEY_ALIAS = "samurai_message_timeline_v1"
    private const val PREFIX = "event_"
    private const val MAX_EVENTS = 500
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val IV_LENGTH_BYTES = 12
    private const val TAG_LENGTH_BITS = 128

    @Synchronized
    fun recordNotificationCaptured(
        context: Context,
        packageName: String,
        notificationKey: String,
        eventTime: Long
    ) {
        val sourceReference = sha256("$packageName|$notificationKey|$eventTime")
        append(
            context,
            eventType = "INCOMING_NOTIFICATION_CAPTURED",
            source = "ANDROID_NOTIFICATION",
            reference = sourceReference,
            eventTime = eventTime,
            summary = if (packageName == "com.whatsapp.w4b") {
                "WhatsApp Business notification captured"
            } else {
                "WhatsApp notification captured"
            },
            stableId = "notification:$sourceReference"
        )
    }

    @Synchronized
    fun recordChatExportImported(
        context: Context,
        sourceHash: String,
        messageCount: Int
    ) {
        append(
            context,
            eventType = "CHAT_EXPORT_IMPORTED",
            source = "USER_SELECTED_CHAT_EXPORT",
            reference = sourceHash,
            eventTime = null,
            summary = "Imported $messageCount messages from a user-selected chat export",
            stableId = "chat-export:$sourceHash"
        )
    }

    @Synchronized
    internal fun append(
        context: Context,
        eventType: String,
        source: String,
        reference: String,
        eventTime: Long?,
        summary: String,
        stableId: String? = null
    ) {
        require(eventType in ALLOWED_EVENT_TYPES) { "Unsupported timeline event type" }
        require(source in ALLOWED_SOURCES) { "Unsupported event source" }
        require(reference.length <= 160) { "Timeline reference is too long" }
        require(summary.length <= 240) { "Timeline summary is too long" }

        val id = stableId?.let { sha256(it) } ?: UUID.randomUUID().toString()
        val key = PREFIX + id
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val event = TimelineEvent(
            id = id,
            eventType = eventType,
            source = source,
            reference = reference,
            eventTime = eventTime,
            observedAt = System.currentTimeMillis(),
            summary = summary
        )
        val encrypted = encrypt(event.toJson().toString())
        val existing = prefs.all.keys.filter { it.startsWith(PREFIX) }.sorted()
        val saved = prefs.edit().putString(key, encrypted).commit()
        check(saved) { "Could not persist encrypted timeline event" }

        if (key !in existing && existing.size >= MAX_EVENTS) {
            prefs.edit().also { editor ->
                existing.take(existing.size - MAX_EVENTS + 1).forEach(editor::remove)
            }.commit()
        }
    }

    @Synchronized
    fun list(context: Context): List<TimelineEvent> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return prefs.all.entries
            .filter { it.key.startsWith(PREFIX) }
            .mapNotNull { entry ->
                runCatching {
                    val encrypted = entry.value as? String ?: return@runCatching null
                    TimelineEvent.fromJson(decrypt(encrypted))
                }.getOrNull()
            }
            .sortedByDescending { it.observedAt }
    }

    @Synchronized
    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit()
        runCatching {
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                .deleteEntry(KEY_ALIAS)
        }
    }

    internal fun encryptedValuesForTest(context: Context): List<String> =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).all.entries
            .filter { it.key.startsWith(PREFIX) }
            .mapNotNull { it.value as? String }

    private fun encrypt(plainText: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply {
            init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        }
        val bytes = cipher.iv + cipher.doFinal(plainText.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    private fun decrypt(payload: String): String {
        val bytes = Base64.decode(payload, Base64.NO_WRAP)
        require(bytes.size > IV_LENGTH_BYTES) { "Invalid timeline ciphertext" }
        val cipher = Cipher.getInstance(TRANSFORMATION).apply {
            init(
                Cipher.DECRYPT_MODE,
                getOrCreateKey(),
                GCMParameterSpec(TAG_LENGTH_BITS, bytes.copyOfRange(0, IV_LENGTH_BYTES))
            )
        }
        return String(cipher.doFinal(bytes.copyOfRange(IV_LENGTH_BYTES, bytes.size)), Charsets.UTF_8)
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

    private fun sha256(value: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

    private fun TimelineEvent.toJson() = JSONObject()
        .put("id", id)
        .put("eventType", eventType)
        .put("source", source)
        .put("reference", reference)
        .put("eventTime", eventTime ?: JSONObject.NULL)
        .put("observedAt", observedAt)
        .put("summary", summary)

    private val ALLOWED_EVENT_TYPES = setOf(
        "INCOMING_NOTIFICATION_CAPTURED",
        "CHAT_EXPORT_IMPORTED",
        "SERVER_ACCEPTED",
        "DEVICE_DELIVERED",
        "READ_CONFIRMED",
        "MEDIA_PLAYED",
        "PRESENCE_ONLINE_OBSERVED",
        "PRESENCE_OFFLINE_OBSERVED"
    )
    private val ALLOWED_SOURCES = setOf(
        "ANDROID_NOTIFICATION",
        "USER_SELECTED_CHAT_EXPORT",
        "WHATSAPP_CLOUD_API",
        "LAB_WEB_SESSION"
    )
}
