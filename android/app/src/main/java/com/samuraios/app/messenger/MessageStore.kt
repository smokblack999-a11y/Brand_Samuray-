package com.samuraios.app.messenger

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Minimal encrypted-at-rest prototype store.
 * Data is AES-GCM encrypted before writing. This is an initial single-file store;
 * production requires transactional database, migrations, concurrency handling,
 * key rotation, and security review.
 */
class MessageStore(context: Context) {
    private val file = File(context.filesDir, "samurai_messages.enc")
    private val keyAlias = "samurai_messenger_store_v1"
    private val lock = Any()

    fun put(record: MessageRecord) = synchronized(lock) {
        val all = readAllUnlocked().associateBy { it.id }.toMutableMap()
        all[record.id] = record
        writeAllUnlocked(all.values.toList())
    }

    fun get(id: String): MessageRecord? = synchronized(lock) {
        readAllUnlocked().firstOrNull { it.id == id }
    }

    fun listConversation(conversationId: String): List<MessageRecord> = synchronized(lock) {
        readAllUnlocked().filter { it.conversationId == conversationId }.sortedBy { it.createdAtMillis }
    }

    fun delete(id: String) = synchronized(lock) {
        writeAllUnlocked(readAllUnlocked().filterNot { it.id == id })
    }

    fun purgeExpired(nowMillis: Long): Int = synchronized(lock) {
        val records = readAllUnlocked()
        val kept = records.filterNot { it.isExpired(nowMillis) }
        val removed = records.size - kept.size
        if (removed > 0) writeAllUnlocked(kept)
        removed
    }

    private fun readAllUnlocked(): List<MessageRecord> {
        if (!file.exists()) return emptyList()
        val raw = file.readBytes()
        require(raw.size > 28) { "Encrypted store is truncated" }
        val nonce = raw.copyOfRange(0, 12)
        val ciphertext = raw.copyOfRange(12, raw.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, nonce))
        val json = JSONArray(String(cipher.doFinal(ciphertext), Charsets.UTF_8))
        return (0 until json.length()).map { index ->
            val o = json.getJSONObject(index)
            MessageRecord(
                id = o.getString("id"),
                conversationId = o.getString("conversationId"),
                senderId = o.getString("senderId"),
                body = o.getString("body"),
                createdAtMillis = o.getLong("createdAt"),
                deliveryState = MessageDeliveryState.valueOf(o.getString("deliveryState")),
                readAtMillis = if (o.isNull("readAt")) null else o.getLong("readAt"),
                expiresAtMillis = if (o.isNull("expiresAt")) null else o.getLong("expiresAt")
            )
        }
    }

    private fun writeAllUnlocked(records: List<MessageRecord>) {
        val json = JSONArray()
        records.forEach { record ->
            json.put(JSONObject().apply {
                put("id", record.id)
                put("conversationId", record.conversationId)
                put("senderId", record.senderId)
                put("body", record.body)
                put("createdAt", record.createdAtMillis)
                put("deliveryState", record.deliveryState.name)
                put("readAt", record.readAtMillis ?: JSONObject.NULL)
                put("expiresAt", record.expiresAtMillis ?: JSONObject.NULL)
            })
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val nonce = cipher.iv
        val ciphertext = cipher.doFinal(json.toString().toByteArray(Charsets.UTF_8))
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeBytes(nonce + ciphertext)
        if (file.exists() && !file.delete()) throw IllegalStateException("Unable to replace encrypted store")
        if (!tmp.renameTo(file)) throw IllegalStateException("Unable to commit encrypted store")
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(keyAlias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                keyAlias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }
}
