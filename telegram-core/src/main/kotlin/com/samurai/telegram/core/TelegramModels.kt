package com.samurai.telegram.core

/** Stable host-facing models. No TDLib classes cross this boundary. */
@JvmInline
value class AccountId(val value: String) {
    init { require(value.isNotBlank()) { "AccountId must not be blank" } }
}
@JvmInline
value class ChatId(val value: String) {
    init { require(value.isNotBlank()) { "ChatId must not be blank" } }
}
@JvmInline
value class MessageId(val value: String) {
    init { require(value.isNotBlank()) { "MessageId must not be blank" } }
}

enum class AuthorizationState { UNINITIALIZED, WAIT_PHONE, WAIT_CODE, WAIT_PASSWORD, AUTHORIZED, LOGGING_OUT }
enum class ConnectionState { CONNECTING, CONNECTED, WAITING_FOR_NETWORK, CLOSED }
enum class MessageDeliveryState { PENDING, SENDING, SENT, FAILED }

data class TelegramChat(val id: ChatId, val title: String, val unreadCount: Int = 0, val isPinned: Boolean = false) {
    init {
        require(title.isNotBlank()) { "Chat title must not be blank" }
        require(unreadCount >= 0) { "Unread count cannot be negative" }
    }
}
data class TelegramMessage(
    val id: MessageId,
    val chatId: ChatId,
    val senderId: String?,
    val text: String?,
    val timestampEpochSeconds: Long,
    val outgoing: Boolean,
    val deliveryState: MessageDeliveryState
)

sealed interface TelegramEvent {
    data class AuthorizationChanged(val state: AuthorizationState) : TelegramEvent
    data class ConnectionChanged(val state: ConnectionState) : TelegramEvent
    data class ChatChanged(val chat: TelegramChat) : TelegramEvent
    data class NewMessage(val message: TelegramMessage) : TelegramEvent
    data class MessageUpdated(val message: TelegramMessage) : TelegramEvent
    data class TransferProgress(val transferId: String, val completedBytes: Long, val totalBytes: Long) : TelegramEvent {
        init {
            require(transferId.isNotBlank())
            require(completedBytes >= 0)
            require(totalBytes >= 0)
            require(totalBytes == 0L || completedBytes <= totalBytes)
        }
    }
    data class OperationFailed(val operation: String, val safeCode: String, val retryable: Boolean) : TelegramEvent
}
