package com.samurai.whatsapp

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NotificationArchiveTest {
    private val context: Context
        get() = ApplicationProvider.getApplicationContext()

    @Before
    fun setUp() {
        NotificationArchive.setEnabled(context, true)
        NotificationArchive.clear(context)
    }

    @After
    fun tearDown() {
        NotificationArchive.clear(context)
        NotificationArchive.setEnabled(context, true)
    }

    @Test
    fun savesEncryptedRecordAndReadsItBack() {
        val secretText = "samurai-private-message-9f3a"
        NotificationArchive.save(
            context = context,
            packageName = "com.whatsapp",
            title = "Test sender",
            body = secretText,
            timestamp = 1_800_000_000_000L
        )

        val records = NotificationArchive.readAll(context)
        assertEquals(1, records.size)
        assertEquals("com.whatsapp", records.single().packageName)
        assertEquals("Test sender", records.single().title)
        assertEquals(secretText, records.single().body)

        val storedValues = context
            .getSharedPreferences("samurai_notification_archive", Context.MODE_PRIVATE)
            .all
            .filterKeys { it.startsWith("entry_") }
            .values
            .mapNotNull { it as? String }

        assertEquals(1, storedValues.size)
        assertFalse("Plaintext must not be stored in preferences", storedValues.single().contains(secretText))
    }

    @Test
    fun duplicateNotificationUpdateDoesNotCreateAnotherEntry() {
        NotificationArchive.save(
            context = context,
            packageName = "com.whatsapp",
            title = "Chat",
            body = "First snapshot",
            timestamp = 1_800_000_000_010L,
            dedupeKey = "notification-key|message-1"
        )
        NotificationArchive.save(
            context = context,
            packageName = "com.whatsapp",
            title = "Chat",
            body = "Updated snapshot",
            timestamp = 1_800_000_000_010L,
            dedupeKey = "notification-key|message-1"
        )

        val records = NotificationArchive.readAll(context)
        assertEquals(1, records.size)
        assertEquals("Updated snapshot", records.single().body)
    }

    @Test
    fun pausePreventsNewArchiveEntries() {
        NotificationArchive.setEnabled(context, false)
        NotificationArchive.save(
            context = context,
            packageName = "com.whatsapp",
            title = "Paused",
            body = "This must not be stored",
            timestamp = 1_800_000_000_001L
        )

        assertTrue(NotificationArchive.readAll(context).isEmpty())
    }

    @Test
    fun manifestKeepsListenerPrivateAndAppOffline() {
        val service = context.packageManager.getServiceInfo(
            ComponentName(context, WhatsAppNotificationListener::class.java),
            0
        )
        assertFalse(service.exported)
        assertEquals("android.permission.BIND_NOTIFICATION_LISTENER_SERVICE", service.permission)

        @Suppress("DEPRECATION")
        val packageInfo = context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.GET_PERMISSIONS
        )
        val permissions = packageInfo.requestedPermissions.orEmpty()
        assertFalse("Companion must not request INTERNET", permissions.contains("android.permission.INTERNET"))
        assertFalse(
            "Archive must not be included in Android backup",
            (context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_ALLOW_BACKUP) != 0
        )
    }

    @Test
    fun archiveIsBoundedToTwoHundredEntries() {
        repeat(205) { index ->
            NotificationArchive.save(
                context = context,
                packageName = "com.whatsapp",
                title = "Sender $index",
                body = "Message $index",
                timestamp = 1_800_000_000_000L + index
            )
        }

        assertEquals(200, NotificationArchive.readAll(context).size)
    }
}
