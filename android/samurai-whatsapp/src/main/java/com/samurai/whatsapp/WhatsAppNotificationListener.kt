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

        val notification = sbn.notification ?: return
        val extras = notification.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val body = extractVisibleBody(notification)

        // Do not persist empty, hidden, or media-only notifications.
        if (title.isBlank() && body.isBlank()) return

        runCatching {
            NotificationArchive.save(
                applicationContext,
                packageName = sbn.packageName,
                title = title.take(MAX_FIELD_LENGTH),
                body = body.take(MAX_FIELD_LENGTH),
                timestamp = sbn.postTime
            )
        }
    }

    /**
     * WhatsApp commonly uses MessagingStyle. Read only message text already
     * exposed in the Android notification; never inspect app-private storage.
     */
    private fun extractVisibleBody(notification: Notification): String {
        val extras = notification.extras

        val messagingText = runCatching {
            Notification.MessagingStyle
                .extractMessagingStyleFromNotification(notification)
                ?.messages
                ?.takeLast(MAX_MESSAGING_LINES)
                ?.mapNotNull { message ->
                    val text = message.text?.toString()?.trim().orEmpty()
                    if (text.isBlank()) return@mapNotNull null
                    val sender = message.sender?.toString()?.trim().orEmpty()
                    if (sender.isBlank()) text else "$sender: $text"
                }
                ?.joinToString("\n")
                .orEmpty()
        }.getOrDefault("")

        if (messagingText.isNotBlank()) return messagingText

        val lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
            ?.map { it.toString() }
            ?.filter { it.isNotBlank() }
            ?.takeLast(MAX_MESSAGING_LINES)
            ?.joinToString("\n")
            .orEmpty()

        return (
            extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
                ?.takeIf { it.isNotBlank() }
                ?: extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
                    ?.takeIf { it.isNotBlank() }
                ?: lines
            ).orEmpty()
    }

    companion object {
        private const val MAX_FIELD_LENGTH = 2_000
        private const val MAX_MESSAGING_LINES = 10
        private val SUPPORTED_PACKAGES = setOf(
            "com.whatsapp",
            "com.whatsapp.w4b"
        )
    }
}
