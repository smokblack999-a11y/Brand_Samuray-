package com.samurai.whatsapp

import android.content.Context
import android.net.Uri
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.security.KeyStore
import java.security.MessageDigest
import java.text.ParsePosition
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import java.util.zip.ZipInputStream
import javax.crypto.Cipher
import javax.crypto.CipherInputStream
import javax.crypto.CipherOutputStream
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONArray
import org.json.JSONObject

internal data class ExportedChatMessage(
    val timestamp: Long?,
    val sender: String?,
    val text: String
)

internal data class ParsedWhatsAppExport(
    val chatName: String,
    val sourceName: String,
    val sourceHash: String,
    val messages: List<ExportedChatMessage>
)

internal data class ImportedChatSummary(
    val id: String,
    val chatName: String,
    val sourceName: String,
    val messageCount: Int,
    val importedAt: Long
)

/**
 * Imports the user's own WhatsApp "Export chat" TXT/ZIP files.
 * It never reads WhatsApp's private database or account/session credentials.
 */
internal object WhatsAppExportImporter {
    private const val MAX_SOURCE_BYTES = 20 * 1024 * 1024
    private const val MAX_MESSAGES = 20_000
    private const val MAX_MESSAGE_CHARS = 20_000

    private val bracketedLine = Regex("^\\[(.+?)]\\s?(.*)$")
    private val dashedLine = Regex("^(.+?)\\s[-–]\\s(.*)$")
    private val senderLine = Regex("^([^:\\r\\n]{1,100}):\\s?(.*)$")

    fun readAndParse(context: Context, uri: Uri, sourceName: String): ParsedWhatsAppExport {
        val input = context.contentResolver.openInputStream(uri)
            ?: throw IllegalArgumentException("Selected export cannot be opened")
        val bytes = input.use { readLimited(it, MAX_SOURCE_BYTES) }
        return parse(bytes, sourceName)
    }

    internal fun parse(sourceBytes: ByteArray, sourceName: String): ParsedWhatsAppExport {
        require(sourceBytes.isNotEmpty()) { "Chat export is empty" }
        require(sourceBytes.size <= MAX_SOURCE_BYTES) { "Chat export exceeds the 20 MiB import limit" }

        val textBytes = extractText(sourceBytes, sourceName)
        val content = String(textBytes, Charsets.UTF_8).removePrefix("\uFEFF")
        val messages = parseLines(content)
        require(messages.isNotEmpty()) {
            "No WhatsApp messages were recognized. Check that this is an official WhatsApp chat export."
        }

        val normalizedName = chatNameFromSource(sourceName)
        return ParsedWhatsAppExport(
            chatName = normalizedName,
            sourceName = sourceName.take(180),
            sourceHash = sha256(sourceBytes),
            messages = messages
        )
    }

    private fun extractText(bytes: ByteArray, sourceName: String): ByteArray {
        val isZip = sourceName.endsWith(".zip", ignoreCase = true) ||
            (bytes.size >= 4 && bytes[0] == 0x50.toByte() && bytes[1] == 0x4b.toByte())

        if (!isZip) return bytes

        ZipInputStream(bytes.inputStream()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                if (!entry.isDirectory && entry.name.endsWith(".txt", ignoreCase = true)) {
                    val extracted = readLimited(zip, MAX_SOURCE_BYTES)
                    require(extracted.isNotEmpty()) { "The ZIP export contains an empty TXT file" }
                    return extracted
                }
            }
        }
        throw IllegalArgumentException("The ZIP archive does not contain a WhatsApp chat TXT file")
    }

    private fun parseLines(content: String): List<ExportedChatMessage> {
        val result = ArrayList<ExportedChatMessage>()
        var currentTimestamp: Long? = null
        var currentSender: String? = null
        var currentText = StringBuilder()

        fun finishCurrent() {
            if (currentText.isNotEmpty()) {
                result.add(
                    ExportedChatMessage(
                        timestamp = currentTimestamp,
                        sender = currentSender,
                        text = currentText.toString().take(MAX_MESSAGE_CHARS)
                    )
                )
                require(result.size <= MAX_MESSAGES) {
                    "Chat export exceeds the $MAX_MESSAGES message import limit"
                }
            }
        }

        content.lineSequence().forEach { rawLine ->
            val line = rawLine.removeSuffix("\r")
            val parsed = parseMessageStart(line)
            if (parsed != null) {
                finishCurrent()
                currentTimestamp = parsed.first
                val payload = parsed.second
                val senderMatch = senderLine.matchEntire(payload)
                currentSender = senderMatch?.groupValues?.get(1)?.trim()?.takeIf { it.isNotBlank() }
                val body = senderMatch?.groupValues?.get(2) ?: payload
                currentText = StringBuilder(body.take(MAX_MESSAGE_CHARS))
            } else if (currentText.isNotEmpty()) {
                if (currentText.length < MAX_MESSAGE_CHARS) {
                    currentText.append('\n').append(line.take(MAX_MESSAGE_CHARS - currentText.length))
                }
            }
        }
        finishCurrent()
        return result
    }

    private fun parseMessageStart(line: String): Pair<Long?, String>? {
        val bracket = bracketedLine.matchEntire(line)
        if (bracket != null) {
            val timestamp = parseTimestamp(bracket.groupValues[1])
            if (timestamp != null) return timestamp to bracket.groupValues[2]
        }

        val dashed = dashedLine.matchEntire(line)
        if (dashed != null) {
            val timestamp = parseTimestamp(dashed.groupValues[1])
            if (timestamp != null) return timestamp to dashed.groupValues[2]
        }
        return null
    }

    private fun parseTimestamp(value: String): Long? {
        val cleaned = value.trim().trim('[', ']')
        val locale = Locale.getDefault()
        val usOrder = locale.country.equals("US", ignoreCase = true) ||
            locale.country.equals("PH", ignoreCase = true)

        val patterns = buildList {
            add("yyyy-MM-dd, HH:mm:ss")
            add("yyyy-MM-dd, HH:mm")
            add("dd.MM.yyyy, HH:mm:ss")
            add("dd.MM.yyyy, HH:mm")
            add("dd.MM.yy, HH:mm:ss")
            add("dd.MM.yy, HH:mm")
            if (usOrder) {
                add("M/d/yy, h:mm:ss a")
                add("M/d/yy, h:mm a")
                add("M/d/yy, HH:mm:ss")
                add("M/d/yy, HH:mm")
                add("M/d/yyyy, h:mm:ss a")
                add("M/d/yyyy, h:mm a")
                add("M/d/yyyy, HH:mm")
            } else {
                add("d/M/yy, h:mm:ss a")
                add("d/M/yy, h:mm a")
                add("d/M/yy, HH:mm:ss")
                add("d/M/yy, HH:mm")
                add("d/M/yyyy, HH:mm:ss")
                add("d/M/yyyy, HH:mm")
                add("M/d/yy, h:mm:ss a")
                add("M/d/yy, h:mm a")
                add("M/d/yy, HH:mm")
            }
        }

        for (pattern in patterns) {
            val formatter = SimpleDateFormat(pattern, locale).apply { isLenient = false }
            val position = ParsePosition(0)
            val date: Date? = formatter.parse(cleaned, position)
            if (date != null && position.index == cleaned.length) return date.time
        }
        return null
    }

    private fun chatNameFromSource(sourceName: String): String {
        val name = sourceName.substringAfterLast('/').substringAfterLast('\\')
            .removeSuffix(".txt").removeSuffix(".TXT")
            .removeSuffix(".zip").removeSuffix(".ZIP")
            .removePrefix("WhatsApp Chat with ")
            .removePrefix("WhatsApp chat with ")
        return name.take(100).ifBlank { "Imported WhatsApp chat" }
    }

    private fun readLimited(input: InputStream, limit: Int): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        var total = 0
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (count == 0) continue
            total += count
            require(total <= limit) { "Chat export exceeds the 20 MiB import limit" }
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
}

/**
 * Stores each imported conversation as one authenticated encrypted file in app-private
 * storage. The index metadata in SharedPreferences is also encrypted.
 */
internal object WhatsAppExportArchive {
    private const val PREFS = "samurai_whatsapp_exports"
    private const val KEY_ALIAS = "samurai_whatsapp_exports_v1"
    private const val DIRECTORY = "samurai_whatsapp_exports"
    private const val ENTRY_PREFIX = "export_"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val IV_LENGTH_BYTES = 12
    private const val TAG_LENGTH_BITS = 128
    private const val MAX_EXPORTS = 100
    private const val MAX_MESSAGES_PER_EXPORT = 20_000
    private const val MAX_PLAINTEXT_BYTES = 24 * 1024 * 1024

    @Synchronized
    fun save(context: Context, export: ParsedWhatsAppExport): ImportedChatSummary {
        require(export.messages.size in 1..MAX_MESSAGES_PER_EXPORT) {
            "Imported chat message count is outside the allowed range"
        }
        summaries(context).firstOrNull { it.first == export.sourceHash }?.let { return it.second }
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        require(prefs.all.keys.count { it.startsWith(ENTRY_PREFIX) } < MAX_EXPORTS) {
            "Imported chat archive is full (maximum $MAX_EXPORTS chats)"
        }

        val id = UUID.randomUUID().toString()
        val json = JSONObject()
            .put("id", id)
            .put("chatName", export.chatName)
            .put("sourceName", export.sourceName)
            .put("sourceHash", export.sourceHash)
            .put("messages", JSONArray().apply {
                export.messages.forEach { message ->
                    put(
                        JSONObject()
                            .put("timestamp", message.timestamp ?: JSONObject.NULL)
                            .put("sender", message.sender ?: JSONObject.NULL)
                            .put("text", message.text)
                    )
                }
            })
            .toString()
        val plainBytes = json.toByteArray(Charsets.UTF_8)
        require(plainBytes.size <= MAX_PLAINTEXT_BYTES) {
            "Normalized chat export exceeds the 24 MiB archive limit"
        }

        val file = dataFile(context, id)
        try {
            val cipher = Cipher.getInstance(TRANSFORMATION).apply {
                init(Cipher.ENCRYPT_MODE, getOrCreateKey())
            }
            FileOutputStream(file).use { fileOutput ->
                fileOutput.write(cipher.iv)
                CipherOutputStream(fileOutput, cipher).use { encryptedOutput ->
                    encryptedOutput.write(plainBytes)
                }
            }

            val summary = ImportedChatSummary(
                id = id,
                chatName = export.chatName,
                sourceName = export.sourceName,
                messageCount = export.messages.size,
                importedAt = System.currentTimeMillis()
            )
            val metadata = JSONObject()
                .put("id", summary.id)
                .put("chatName", summary.chatName)
                .put("sourceName", summary.sourceName)
                .put("sourceHash", export.sourceHash)
                .put("messageCount", summary.messageCount)
                .put("importedAt", summary.importedAt)
                .toString()
            val saved = prefs.edit()
                .putString(ENTRY_PREFIX + id, encryptMetadata(metadata))
                .commit()
            check(saved) { "Could not save encrypted chat-export index" }
            return summary
        } catch (error: Exception) {
            file.delete()
            throw error
        }
    }

    @Synchronized
    fun list(context: Context): List<ImportedChatSummary> =
        summaries(context).map { it.second }.sortedByDescending { it.importedAt }

    @Synchronized
    fun readMessages(context: Context, id: String): List<ExportedChatMessage> {
        val summary = list(context).firstOrNull { it.id == id }
            ?: throw IllegalArgumentException("Imported chat not found")
        val file = dataFile(context, summary.id)
        require(file.isFile) { "Imported chat file is missing" }

        val plain = FileInputStream(file).use { encryptedInput ->
            val iv = ByteArray(IV_LENGTH_BYTES)
            var offset = 0
            while (offset < iv.size) {
                val count = encryptedInput.read(iv, offset, iv.size - offset)
                require(count > 0) { "Invalid encrypted chat export" }
                offset += count
            }
            val cipher = Cipher.getInstance(TRANSFORMATION).apply {
                init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(TAG_LENGTH_BITS, iv))
            }
            CipherInputStream(encryptedInput, cipher).use { decryptedInput ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(16 * 1024)
                var total = 0
                while (true) {
                    val count = decryptedInput.read(buffer)
                    if (count < 0) break
                    if (count == 0) continue
                    total += count
                    require(total <= MAX_PLAINTEXT_BYTES) { "Stored chat export exceeds safety limit" }
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
        }

        val json = JSONObject(String(plain, Charsets.UTF_8))
        val messages = json.getJSONArray("messages")
        return (0 until messages.length()).map { index ->
            val item = messages.getJSONObject(index)
            val timestamp = item.opt("timestamp").let { value ->
                if (value == null || value == JSONObject.NULL) null else item.getLong("timestamp")
            }
            val sender = item.opt("sender").let { value ->
                if (value == null || value == JSONObject.NULL) null else item.getString("sender")
            }
            ExportedChatMessage(timestamp, sender, item.getString("text"))
        }
    }

    @Synchronized
    fun delete(context: Context, id: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(ENTRY_PREFIX + id).commit()
        dataFile(context, id).delete()
    }

    @Synchronized
    fun clear(context: Context) {
        vaultDirectory(context).listFiles()?.forEach { it.delete() }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit()
        runCatching {
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(KEY_ALIAS)
        }
    }

    internal fun ciphertextFileForTest(context: Context, id: String): File = dataFile(context, id)

    private fun summaries(context: Context): List<Pair<String, ImportedChatSummary>> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return prefs.all.entries
            .filter { it.key.startsWith(ENTRY_PREFIX) }
            .mapNotNull { entry ->
                runCatching {
                    val payload = entry.value as? String ?: return@runCatching null
                    val json = JSONObject(decryptMetadata(payload))
                    val summary = ImportedChatSummary(
                        id = json.getString("id"),
                        chatName = json.getString("chatName"),
                        sourceName = json.getString("sourceName"),
                        messageCount = json.getInt("messageCount"),
                        importedAt = json.getLong("importedAt")
                    )
                    if (dataFile(context, summary.id).isFile) {
                        json.getString("sourceHash") to summary
                    } else null
                }.getOrNull()
            }
    }

    private fun encryptMetadata(plainText: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, getOrCreateKey()) }
        return Base64.encodeToString(cipher.iv + cipher.doFinal(plainText.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }

    private fun decryptMetadata(payload: String): String {
        val bytes = Base64.decode(payload, Base64.NO_WRAP)
        require(bytes.size > IV_LENGTH_BYTES) { "Invalid encrypted chat index" }
        val cipher = Cipher.getInstance(TRANSFORMATION).apply {
            init(
                Cipher.DECRYPT_MODE,
                getOrCreateKey(),
                GCMParameterSpec(TAG_LENGTH_BITS, bytes.copyOfRange(0, IV_LENGTH_BYTES))
            )
        }
        return String(cipher.doFinal(bytes.copyOfRange(IV_LENGTH_BYTES, bytes.size)), Charsets.UTF_8)
    }

    private fun vaultDirectory(context: Context): File =
        File(context.filesDir, DIRECTORY).apply { mkdirs() }

    private fun dataFile(context: Context, id: String): File {
        require(id.matches(Regex("[0-9a-fA-F-]{36}"))) { "Invalid imported chat id" }
        return File(vaultDirectory(context), "$id.wexp")
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
