package com.samurai.whatsapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class StatusSaverTest {
    @Test
    fun recognizesStatusesFolderNames() {
        assertTrue(StatusSaver.isStatusesFolder(".Statuses"))
        assertTrue(StatusSaver.isStatusesFolder("statuses"))
        assertFalse(StatusSaver.isStatusesFolder("Media"))
        assertFalse(StatusSaver.isStatusesFolder("WhatsApp Images"))
    }

    @Test
    fun normalizesCommonStatusFileMimeTypes() {
        assertEquals("image/jpeg", StatusSaver.normalizeMimeType("application/octet-stream", "IMG-1.jpg"))
        assertEquals("image/webp", StatusSaver.normalizeMimeType("", "IMG-2.webp"))
        assertEquals("video/mp4", StatusSaver.normalizeMimeType("application/octet-stream", "VID-3.mp4"))
        assertEquals("image/png", StatusSaver.normalizeMimeType("image/png", "file.bin"))
    }

    @Test
    fun ignoresUnknownFileExtensions() {
        assertEquals(
            "application/octet-stream",
            StatusSaver.normalizeMimeType("", "cache.dat")
        )
    }
}
