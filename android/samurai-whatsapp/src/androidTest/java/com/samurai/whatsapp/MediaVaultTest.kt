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
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class MediaVaultTest {
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
    fun clearDeletesOrphanedCiphertextFilesNotPresentInTheIndex() {
        val orphanId = UUID.randomUUID().toString()
        val orphanFile = MediaVault.ciphertextFileForTest(context, orphanId)
        orphanFile.writeBytes(byteArrayOf(4, 3, 2, 1))

        MediaVault.clear(context)

        assertFalse(orphanFile.exists())
        assertTrue(MediaVault.list(context).isEmpty())
    }

    @Test
    fun rejectsInvalidIdsBeforeBuildingVaultFilePaths() {
        var rejected = false
        try {
            MediaVault.ciphertextFileForTest(context, "../../outside")
        } catch (_: IllegalArgumentException) {
            rejected = true
        }
        assertTrue("Vault IDs must not permit path traversal", rejected)
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
