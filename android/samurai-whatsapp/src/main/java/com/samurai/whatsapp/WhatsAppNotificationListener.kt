package com.samurai.whatsapp

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Captures only notification text explicitly made visible by Android.
 * This is not a WhatsApp protocol integration and cannot detect every message,
 * deleted message, read receipt, or view-once media item.
 */
class WhatsAppNotificationListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName !in SUPPORTED_PACKAGES) return

        val extras = sbn.notification?.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = (
            extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
                ?: extras.getCharSequence(Notification.EXTRA_TEXT)
            )?.toString().orEmpty()

        // Do not persist empty, hidden, or media-only notifications.
        if (title.isBlank() && text.isBlank()) return

        runCatching {
            NotificationArchive.save(
                applicationContext,
                packageName = sbn.packageName,
                title = title.take(MAX_FIELD_LENGTH),
                body = text.take(MAX_FIELD_LENGTH),
                timestamp = sbn.postTime
            )
        }
    }

    companion object {
        private const val MAX_FIELD_LENGTH = 2_000
        private val SUPPORTED_PACKAGES = setOf(
            "com.whatsapp",
            "com.whatsapp.w4b"
        )
    }
}
