package com.samurai.whatsapp

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat

/**
 * Captures only text already exposed by Android notifications.
 * This does not access WhatsApp private storage or alter WhatsApp protocol state.
 */
class WhatsAppNotificationListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName !in SUPPORTED_PACKAGES) return

        val notification = sbn.notification ?: return
        val extras = notification.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()

        val messagingStyle = runCatching {
            NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification)
        }.getOrNull()

        val messages = messagingStyle?.messages
            ?.takeLast(MAX_MESSAGING_LINES)
            .orEmpty()

        val visibleMessages = messages.mapNotNull { message ->
            val text = message.text?.toString()?.trim().orEmpty()
            if (text.isBlank()) return@mapNotNull null

            val sender = message.person?.name?.toString()?.trim().orEmpty()
            val body = if (sender.isBlank()) text else "$sender: $text"
            VisibleMessage(
                body = body.take(MAX_FIELD_LENGTH),
                timestamp = message.timestamp,
                dedupeKey = "${sbn.key}|${message.timestamp}|$sender|$text"
            )
        }

        if (visibleMessages.isNotEmpty()) {
            visibleMessages.forEach { message ->
                runCatching {
                    if (NotificationArchive.isEnabled(applicationContext)) {
                        NotificationArchive.save(
                            applicationContext,
                            packageName = sbn.packageName,
                            title = title.take(MAX_FIELD_LENGTH),
                            body = message.body,
                            timestamp = message.timestamp,
                            dedupeKey = message.dedupeKey
                        )
                        MessageTimeline.recordNotificationCaptured(
                            applicationContext,
                            sbn.packageName,
                            sbn.key,
                            message.timestamp
                        )
                    }
                }
            }
            return
        }

        val fallbackBody = extractFallbackBody(notification)
        if (title.isBlank() && fallbackBody.isBlank()) return

        runCatching {
            if (NotificationArchive.isEnabled(applicationContext)) {
                NotificationArchive.save(
                    applicationContext,
                    packageName = sbn.packageName,
                    title = title.take(MAX_FIELD_LENGTH),
                    body = fallbackBody.take(MAX_FIELD_LENGTH),
                    timestamp = sbn.postTime,
                    dedupeKey = "${sbn.key}|${sbn.postTime}|$title|$fallbackBody"
                )
                MessageTimeline.recordNotificationCaptured(
                    applicationContext,
                    sbn.packageName,
                    sbn.key,
                    sbn.postTime
                )
            }
        }
    }

    private fun extractFallbackBody(notification: Notification): String {
        val extras = notification.extras
        val lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
            ?.map { it.toString() }
            ?.filter { it.isNotBlank() }
            ?.takeLast(MAX_MESSAGING_LINES)
            ?.joinToString("\n")
            .orEmpty()

        return extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
            ?.takeIf { it.isNotBlank() }
            ?: extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
                ?.takeIf { it.isNotBlank() }
            ?: lines
    }

    private data class VisibleMessage(
        val body: String,
        val timestamp: Long,
        val dedupeKey: String
    )

    companion object {
        private const val MAX_FIELD_LENGTH = 2_000
        private const val MAX_MESSAGING_LINES = 10
        private val SUPPORTED_PACKAGES = setOf(
            "com.whatsapp",
            "com.whatsapp.w4b"
        )
    }
}
