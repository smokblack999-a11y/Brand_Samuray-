package com.samurai.whatsapp

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.CipherInputStream
import javax.crypto.CipherOutputStream
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject

internal data class MediaVaultItem(
    val id: String,
    val displayName: String,
    val mimeType: String,
    val sizeBytes: Long,
    val importedAt: Long
)

/**
 * Stores user-selected image, video and audio files in app-private storage.
 * File payloads and their index metadata are encrypted with separate AES-GCM
 * invocations using a device-bound Android Keystore key.
 */
internal object MediaVault {
    private const val PREFS = "samurai_media_vault"
    private const val KEY_ALIAS = "samurai_whatsapp_media_vault_v1"
    private const val ITEM_PREFIX = "item_"
    private const val DIRECTORY = "samurai_media_vault"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val IV_LENGTH_BYTES = 12
    private const val TAG_LENGTH_BITS = 128
    private const val MAX_ITEMS = 100
    private const val MAX_FILE_BYTES = 250L * 1024L * 1024L
    private const val MAX_TOTAL_BYTES = 1024L * 1024L * 1024L
    private const val BUFFER_SIZE = 16 * 1024

    fun importFromUri(context: Context, uri: Uri, mimeTypeOverride: String? = null): MediaVaultItem {
        val mimeType = mimeTypeOverride ?: context.contentResolver.getType(uri) ?: "application/octet-stream"
        require(isSupportedMimeType(mimeType)) {
            "Only image, video and audio files can be added to Media Vault"
        }
        val displayName = queryDisplayName(context, uri)
        val input = context.contentResolver.openInputStream(uri)
            ?: throw IllegalArgumentException("Selected file cannot be opened")
        return input.use {
            importStream(context, it, displayName, mimeType)
        }
    }

    @Synchronized
    internal fun importStream(
        context: Context,
        input: InputStream,
        displayName: String,
        mimeType: String
    ): MediaVaultItem {
        require(isSupportedMimeType(mimeType)) {
            "Only image, video and audio files can be added to Media Vault"
        }
        val existingItems = list(context)
        require(existingItems.size < MAX_ITEMS) { "Media Vault is full (maximum $MAX_ITEMS files)" }
        val existingBytes = existingItems.fold(0L) { total, item -> total + item.sizeBytes }
        require(existingBytes < MAX_TOTAL_BYTES) { "Media Vault storage limit reached (1 GiB total)" }

        val id = UUID.randomUUID().toString()
        val file = dataFile(context, id)
        var size = 0L

        try {
            val cipher = Cipher.getInstance(TRANSFORMATION).apply {
                init(Cipher.ENCRYPT_MODE, getOrCreateKey())
            }
            FileOutputStream(file).use { fileOutput ->
                fileOutput.write(cipher.iv)
                CipherOutputStream(fileOutput, cipher).use { encryptedOutput ->
                    val buffer = ByteArray(BUFFER_SIZE)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        if (count == 0) continue
                        require(size + count <= MAX_FILE_BYTES) {
                            "Media Vault file exceeds the 250 MiB per-file limit"
                        }
                        require(existingBytes + size + count <= MAX_TOTAL_BYTES) {
                            "Media Vault total storage limit is 1 GiB"
                        }
                        encryptedOutput.write(buffer, 0, count)
                        size += count
                    }
                }
            }

            val item = MediaVaultItem(
                id = id,
                displayName = displayName.take(180).ifBlank { "Imported media" },
                mimeType = mimeType.take(120),
                sizeBytes = size,
                importedAt = System.currentTimeMillis()
            )
            val metadata = JSONObject()
                .put("id", item.id)
                .put("name", item.displayName)
                .put("mime", item.mimeType)
                .put("size", item.sizeBytes)
                .put("importedAt", item.importedAt)
                .toString()

            val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(ITEM_PREFIX + id, encryptMetadata(metadata))
                .commit()
            check(saved) { "Could not save encrypted Media Vault index" }
            return item
        } catch (error: Exception) {
            file.delete()
            throw error
        }
    }

    @Synchronized
    fun list(context: Context): List<MediaVaultItem> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return prefs.all.entries
            .filter { it.key.startsWith(ITEM_PREFIX) }
            .mapNotNull { entry ->
                runCatching {
                    val payload = entry.value as? String ?: return@runCatching null
                    val json = JSONObject(decryptMetadata(payload))
                    val item = MediaVaultItem(
                        id = json.getString("id"),
                        displayName = json.getString("name"),
                        mimeType = json.getString("mime"),
                        sizeBytes = json.getLong("size"),
                        importedAt = json.getLong("importedAt")
                    )
                    item.takeIf { dataFile(context, it.id).isFile }
                }.getOrNull()
            }
            .sortedByDescending { it.importedAt }
    }

    fun exportToUri(context: Context, id: String, destination: Uri) {
        val item = list(context).firstOrNull { it.id == id }
            ?: throw IllegalArgumentException("Media Vault item not found")
        val output = context.contentResolver.openOutputStream(destination, "w")
            ?: throw IllegalArgumentException("Destination file cannot be opened")
        output.use { exportToStream(context, item.id, it) }
    }

    internal fun exportToStream(context: Context, id: String, output: OutputStream) {
        val file = dataFile(context, id)
        require(file.isFile) { "Media Vault item not found" }

        FileInputStream(file).use { encryptedInput ->
            val iv = ByteArray(IV_LENGTH_BYTES)
            var offset = 0
            while (offset < iv.size) {
                val count = encryptedInput.read(iv, offset, iv.size - offset)
                require(count > 0) { "Invalid encrypted Media Vault file" }
                offset += count
            }

            val cipher = Cipher.getInstance(TRANSFORMATION).apply {
                init(
                    Cipher.DECRYPT_MODE,
                    getOrCreateKey(),
                    GCMParameterSpec(TAG_LENGTH_BITS, iv)
                )
            }
            CipherInputStream(encryptedInput, cipher).use { decryptedInput ->
                val buffer = ByteArray(BUFFER_SIZE)
                while (true) {
                    val count = decryptedInput.read(buffer)
                    if (count < 0) break
                    if (count == 0) continue
                    output.write(buffer, 0, count)
                }
                output.flush()
            }
        }
    }

    @Synchronized
    fun delete(context: Context, id: String) {
        val file = dataFile(context, id)
        check(!file.exists() || file.delete()) {
            "Media Vault could not delete the encrypted file"
        }
        val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(ITEM_PREFIX + id)
            .commit()
        check(saved) { "Media Vault could not update its encrypted index" }
    }

    @Synchronized
    fun clear(context: Context) {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (keyStore.containsAlias(KEY_ALIAS)) {
            keyStore.deleteEntry(KEY_ALIAS)
            check(!keyStore.containsAlias(KEY_ALIAS)) {
                "Media Vault could not destroy its encryption key"
            }
        }

        val directory = vaultDirectory(context)
        val files = directory.listFiles()
            ?: if (directory.exists()) {
                throw IllegalStateException("Media Vault directory could not be inspected")
            } else {
                emptyArray()
            }
        files.forEach { file ->
            check(file.delete() || !file.exists()) {
                "Media Vault could not delete encrypted file: " + file.name
            }
        }

        val cleared = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
        check(cleared) { "Media Vault could not clear its encrypted index" }
    }

    internal fun ciphertextFileForTest(context: Context, id: String): File =
        dataFile(context, id)

    private fun queryDisplayName(context: Context, uri: Uri): String {
        context.contentResolver.query(
            uri,
            arrayOf(OpenableColumns.DISPLAY_NAME),
            null,
            null,
            null
        )?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) cursor.getString(index)?.let { return it }
            }
        }
        return uri.lastPathSegment ?: "Imported media"
    }

    private fun isSupportedMimeType(mimeType: String): Boolean =
        mimeType.startsWith("image/") ||
            mimeType.startsWith("video/") ||
            mimeType.startsWith("audio/")

    private fun vaultDirectory(context: Context): File =
        File(context.filesDir, DIRECTORY).apply { mkdirs() }

    private fun dataFile(context: Context, id: String): File {
        require(id.matches(Regex("[0-9a-fA-F-]{36}"))) { "Invalid Media Vault item id" }
        return File(vaultDirectory(context), "$id.svlt")
    }

    private fun encryptMetadata(plainText: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply {
            init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        }
        val encrypted = cipher.doFinal(plainText.toByteArray(Charsets.UTF_8))
        val payload = cipher.iv + encrypted
        return Base64.encodeToString(payload, Base64.NO_WRAP)
    }

    private fun decryptMetadata(payload: String): String {
        val bytes = Base64.decode(payload, Base64.NO_WRAP)
        require(bytes.size > IV_LENGTH_BYTES) { "Invalid Media Vault metadata" }
        val iv = bytes.copyOfRange(0, IV_LENGTH_BYTES)
        val encrypted = bytes.copyOfRange(IV_LENGTH_BYTES, bytes.size)
        val cipher = Cipher.getInstance(TRANSFORMATION).apply {
            init(
                Cipher.DECRYPT_MODE,
                getOrCreateKey(),
                GCMParameterSpec(TAG_LENGTH_BITS, iv)
            )
        }
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
