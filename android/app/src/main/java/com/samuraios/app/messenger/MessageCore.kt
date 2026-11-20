package com.samuraios.app.messenger

/**
 * SAMURAI Messenger domain foundation.
 * Transport-independent model: no network, no UI, no claims of WhatsApp protocol support.
 */
enum class MessageDeliveryState {
    LOCAL_DRAFT,
    QUEUED,
    SENT_TO_SERVER,
    DELIVERED_TO_DEVICE,
    READ_CONFIRMED,
    FAILED,
    UNKNOWN
}

enum class ReceiptVisibility {
    SHOW_ALL,
    HIDE_READ_RECEIPTS,
    HIDE_DELIVERY_RECEIPTS
}

enum class DisappearingMode(val ttlMillis: Long?) {
    OFF(null),
    AFTER_5_MINUTES(5 * 60_000L),
    AFTER_1_HOUR(60 * 60_000L),
    AFTER_24_HOURS(24 * 60 * 60_000L),
    AFTER_7_DAYS(7 * 24 * 60 * 60_000L),
    AFTER_30_DAYS(30 * 24 * 60 * 60_000L)
}

data class MessageRecord(
    val id: String,
    val conversationId: String,
    val senderId: String,
    val body: String,
    val createdAtMillis: Long,
    val deliveryState: MessageDeliveryState = MessageDeliveryState.LOCAL_DRAFT,
    val readAtMillis: Long? = null,
    val expiresAtMillis: Long? = null
) {
    init {
        require(id.isNotBlank())
        require(conversationId.isNotBlank())
        require(senderId.isNotBlank())
        require(createdAtMillis >= 0)
        require(readAtMillis == null || readAtMillis >= createdAtMillis)
        require(expiresAtMillis == null || expiresAtMillis >= createdAtMillis)
        require(deliveryState != MessageDeliveryState.READ_CONFIRMED || readAtMillis != null)
    }

    fun isExpired(nowMillis: Long): Boolean =
        expiresAtMillis?.let { nowMillis >= it } ?: false
}

data class ReceiptPolicy(
    val visibility: ReceiptVisibility,
    val showOwnReadReceipts: Boolean = true
) {
    /** UI policy only; does not suppress protocol/network receipts. */
    fun shouldDisplayReadReceipt(): Boolean =
        visibility == ReceiptVisibility.SHOW_ALL && showOwnReadReceipts
}

object MessageExpiry {
    fun expiration(createdAtMillis: Long, mode: DisappearingMode): Long? {
        val ttl = mode.ttlMillis ?: return null
        require(createdAtMillis >= 0)
        return Math.addExact(createdAtMillis, ttl)
    }

    fun shouldDelete(record: MessageRecord, nowMillis: Long): Boolean =
        record.isExpired(nowMillis)
}
