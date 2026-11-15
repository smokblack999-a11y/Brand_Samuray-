package com.samurai.whatsapp

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.util.Locale
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

@RunWith(AndroidJUnit4::class)
class WhatsAppExportImporterTest {
    private val context: Context
        get() = ApplicationProvider.getApplicationContext()

    @Before
    fun setUp() {
        WhatsAppExportArchive.clear(context)
    }

    @After
    fun tearDown() {
        WhatsAppExportArchive.clear(context)
    }

    @Test
    fun parsesIsoTimestampAndMultilineMessage() {
        val export = """
            2026-11-15, 09:08:12 - Alice: first line
            continuation line
            2026-11-15, 09:10:00 - Bob: second message
        """.trimIndent().toByteArray()

        val parsed = WhatsAppExportImporter.parse(export, "WhatsApp Chat with Demo.txt")

        assertEquals("Demo", parsed.chatName)
        assertEquals(2, parsed.messages.size)
        assertEquals("Alice", parsed.messages[0].sender)
        assertEquals("first line\ncontinuation line", parsed.messages[0].text)
        assertNotNull(parsed.messages[0].timestamp)
        assertEquals("Bob", parsed.messages[1].sender)
        assertEquals("second message", parsed.messages[1].text)
    }

    @Test
    fun parsesBracketedUsTimestampWhenSystemLocaleIsNotUs() {
        val original = Locale.getDefault()
        try {
            Locale.setDefault(Locale("ru", "KZ"))
            val export = "[11/15/26, 8:12 PM] Alice: hello".toByteArray()
            val parsed = WhatsAppExportImporter.parse(export, "chat.txt")
            assertEquals(1, parsed.messages.size)
            assertEquals("Alice", parsed.messages.single().sender)
            assertNotNull(parsed.messages.single().timestamp)
        } finally {
            Locale.setDefault(original)
        }
    }

    @Test
    fun readsTxtInsideWhatsAppZipExport() {
        val zipBytes = ByteArrayOutputStream().use { output ->
            ZipOutputStream(output).use { zip ->
                zip.putNextEntry(ZipEntry("WhatsApp Chat with Demo.txt"))
                zip.write("2026-11-15, 09:08:12 - Alice: zipped message".toByteArray())
                zip.closeEntry()
                zip.putNextEntry(ZipEntry("IMG-20261115-WA0001.jpg"))
                zip.write(byteArrayOf(1, 2, 3, 4))
                zip.closeEntry()
            }
            output.toByteArray()
        }

        val parsed = WhatsAppExportImporter.parse(zipBytes, "chat-export.zip")

        assertEquals(1, parsed.messages.size)
        assertEquals("zipped message", parsed.messages.single().text)
    }

    @Test
    fun rejectsNonWhatsAppTextAndEmptyZip() {
        var rejectedText = false
        try {
            WhatsAppExportImporter.parse("just some notes".toByteArray(), "notes.txt")
        } catch (_: IllegalArgumentException) {
            rejectedText = true
        }
        assertTrue(rejectedText)

        val emptyZip = ByteArrayOutputStream().use { output ->
            ZipOutputStream(output).use { }
            output.toByteArray()
        }
        var rejectedZip = false
        try {
            WhatsAppExportImporter.parse(emptyZip, "empty.zip")
        } catch (_: IllegalArgumentException) {
            rejectedZip = true
        }
        assertTrue(rejectedZip)
    }

    @Test
    fun encryptedArchiveDeduplicatesAndRestoresExactMessages() {
        val source = """
            2026-11-15, 09:08:12 - Alice: secret archive text
            2026-11-15, 09:10:00 - Bob: second secret
        """.trimIndent().toByteArray()
        val parsed = WhatsAppExportImporter.parse(source, "WhatsApp Chat with VaultTest.txt")

        val first = WhatsAppExportArchive.save(context, parsed)
        val duplicate = WhatsAppExportArchive.save(context, parsed)

        assertEquals(first.id, duplicate.id)
        assertEquals(1, WhatsAppExportArchive.list(context).size)
        assertEquals(2, first.messageCount)

        val file = WhatsAppExportArchive.ciphertextFileForTest(context, first.id)
        assertTrue(file.isFile)
        val stored = String(file.readBytes(), Charsets.ISO_8859_1)
        assertFalse(stored.contains("secret archive text"))

        val restored = WhatsAppExportArchive.readMessages(context, first.id)
        assertEquals(parsed.messages, restored)
    }

    @Test
    fun modifiedCiphertextFailsAuthentication() {
        val parsed = WhatsAppExportImporter.parse(
            "2026-11-15, 09:08:12 - Alice: authenticated payload".toByteArray(),
            "chat.txt"
        )
        val item = WhatsAppExportArchive.save(context, parsed)
        val file = WhatsAppExportArchive.ciphertextFileForTest(context, item.id)
        val tampered = file.readBytes()
        tampered[tampered.lastIndex] = (tampered.last().toInt() xor 0x01).toByte()
        file.writeBytes(tampered)

        val result = runCatching {
            WhatsAppExportArchive.readMessages(context, item.id)
        }
        assertTrue("AES-GCM must reject modified ciphertext", result.isFailure)
    }

    @Test
    fun deleteAndClearRemoveImportedConversations() {
        val parsed = WhatsAppExportImporter.parse(
            "2026-11-15, 09:08:12 - Alice: test".toByteArray(),
            "chat.txt"
        )
        val item = WhatsAppExportArchive.save(context, parsed)
        val file = WhatsAppExportArchive.ciphertextFileForTest(context, item.id)

        WhatsAppExportArchive.delete(context, item.id)

        assertTrue(WhatsAppExportArchive.list(context).isEmpty())
        assertFalse(file.exists())

        val second = WhatsAppExportArchive.save(context, parsed)
        val secondFile = WhatsAppExportArchive.ciphertextFileForTest(context, second.id)
        WhatsAppExportArchive.clear(context)

        assertTrue(WhatsAppExportArchive.list(context).isEmpty())
        assertFalse(secondFile.exists())

        val newItem = WhatsAppExportArchive.save(context, parsed)
        assertEquals(1, WhatsAppExportArchive.readMessages(context, newItem.id).size)
    }
}
