package com.samurai.whatsapp

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

@RunWith(AndroidJUnit4::class)
class MediaVaultTest {
    companion object {
        private const val IV_BYTES_FOR_TEST = 12
    }

    private val context: Context
        get() = ApplicationProvider.getApplicationContext()

    @Before
    fun setUp() {
        MediaVault.clear(context)
    }

    @After
    fun tearDown() {
        MediaVault.clear(context)
    }

    @Test
    fun importsEncryptsListsAndExportsExactBytes() {
        val payload = "samurai-private-media-payload-74a9".toByteArray()
        val item = MediaVault.importStream(
            context = context,
            input = ByteArrayInputStream(payload),
            displayName = "sample-image.jpg",
            mimeType = "image/jpeg"
        )

        assertEquals("sample-image.jpg", item.displayName)
        assertEquals("image/jpeg", item.mimeType)
        assertEquals(payload.size.toLong(), item.sizeBytes)
        assertEquals(item.id, MediaVault.list(context).single().id)

        val encryptedFile = MediaVault.ciphertextFileForTest(context, item.id)
        assertTrue(encryptedFile.isFile)
        val ciphertext = encryptedFile.readBytes()
        val payloadAsText = String(payload, Charsets.UTF_8)
        assertFalse(
            "Media Vault ciphertext must not contain the original plaintext",
            String(ciphertext, Charsets.ISO_8859_1).contains(payloadAsText)
        )

        val exported = ByteArrayOutputStream()
        MediaVault.exportToStream(context, item.id, exported)
        assertArrayEquals(payload, exported.toByteArray())
    }

    @Test
    fun rejectsTamperedAuthenticationTagWithoutWritingPartialPlaintext() {
        val payload = ByteArray(48 * 1024) { (it % 251).toByte() }
        val item = MediaVault.importStream(
            context = context,
            input = ByteArrayInputStream(payload),
            displayName = "tamper-test.mp4",
            mimeType = "video/mp4"
        )
        val encryptedFile = MediaVault.ciphertextFileForTest(context, item.id)
        val ciphertext = encryptedFile.readBytes()
        ciphertext[ciphertext.lastIndex] = (ciphertext.last().toInt() xor 0x01).toByte()
        encryptedFile.writeBytes(ciphertext)

        val destination = ByteArrayOutputStream().apply {
            write("existing-destination".toByteArray())
        }
        val originalDestination = destination.toByteArray()
        val result = runCatching {
            MediaVault.exportToStream(context, item.id, destination)
        }

        assertTrue("A modified GCM tag must fail authentication", result.isFailure)
        assertArrayEquals(
            "No partial plaintext may be appended to the destination",
            originalDestination,
            destination.toByteArray()
        )
        val tempDirectory = java.io.File(context.cacheDir, "media-vault-export")
        assertTrue(
            "Failed authentication must clean temporary plaintext",
            tempDirectory.listFiles().isNullOrEmpty()
        )
    }

    @Test
    fun rejectsModifiedIvWithoutWritingToDestination() {
        val item = MediaVault.importStream(
            context = context,
            input = ByteArrayInputStream("authenticated payload".toByteArray()),
            displayName = "iv-test.jpg",
            mimeType = "image/jpeg"
        )
        val encryptedFile = MediaVault.ciphertextFileForTest(context, item.id)
        val ciphertext = encryptedFile.readBytes()
        ciphertext[0] = (ciphertext[0].toInt() xor 0x01).toByte()
        encryptedFile.writeBytes(ciphertext)

        val destination = ByteArrayOutputStream().apply { write(byteArrayOf(4, 5, 6)) }
        val originalDestination = destination.toByteArray()
        val result = runCatching {
            MediaVault.exportToStream(context, item.id, destination)
        }

        assertTrue("A modified GCM IV must fail authentication", result.isFailure)
        assertArrayEquals(originalDestination, destination.toByteArray())
    }

    @Test
    fun rejectsTruncatedCiphertextWithoutWritingToDestination() {
        val item = MediaVault.importStream(
            context = context,
            input = ByteArrayInputStream(ByteArray(1024) { 7 }),
            displayName = "truncated.png",
            mimeType = "image/png"
        )
        val encryptedFile = MediaVault.ciphertextFileForTest(context, item.id)
        encryptedFile.writeBytes(encryptedFile.readBytes().copyOf(IV_BYTES_FOR_TEST + 5))

        val destination = ByteArrayOutputStream().apply { write(byteArrayOf(9, 8, 7)) }
        val originalDestination = destination.toByteArray()
        val result = runCatching {
            MediaVault.exportToStream(context, item.id, destination)
        }

        assertTrue("Truncated GCM payload must be rejected", result.isFailure)
        assertArrayEquals(originalDestination, destination.toByteArray())
    }

    @Test
    fun rejectsUnsupportedMimeTypes() {
        var rejected = false
        try {
            MediaVault.importStream(
                context = context,
                input = ByteArrayInputStream(byteArrayOf(1, 2, 3)),
                displayName = "notes.txt",
                mimeType = "text/plain"
            )
        } catch (_: IllegalArgumentException) {
            rejected = true
        }
        assertTrue("Unsupported MIME types must be rejected", rejected)
        assertTrue(MediaVault.list(context).isEmpty())
    }

    @Test
    fun deleteRemovesAnItemFromTheVault() {
        val item = MediaVault.importStream(
            context = context,
            input = ByteArrayInputStream(byteArrayOf(8, 7, 6)),
            displayName = "clip.mp4",
            mimeType = "video/mp4"
        )

        MediaVault.delete(context, item.id)

        assertTrue(MediaVault.list(context).isEmpty())
        assertFalse(MediaVault.ciphertextFileForTest(context, item.id).exists())
    }

    @Test
    fun clearRetiresVaultAndANewImportCanBeRead() {
        val oldItem = MediaVault.importStream(
            context = context,
            input = ByteArrayInputStream("old".toByteArray()),
            displayName = "old.png",
            mimeType = "image/png"
        )
        val oldFile = MediaVault.ciphertextFileForTest(context, oldItem.id)

        MediaVault.clear(context)

        assertTrue(MediaVault.list(context).isEmpty())
        assertFalse(oldFile.exists())

        val newPayload = "after-clear".toByteArray()
        val newItem = MediaVault.importStream(
            context = context,
            input = ByteArrayInputStream(newPayload),
            displayName = "new.png",
            mimeType = "image/png"
        )
        val exported = ByteArrayOutputStream()
        MediaVault.exportToStream(context, newItem.id, exported)
        assertArrayEquals(newPayload, exported.toByteArray())
    }
}
