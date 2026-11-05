package com.samurai.telegram.core

import kotlinx.coroutines.flow.Flow

/**
 * Host-facing API for a normal Telegram user account.
 * Interface contract only: production implementation must use TDLib and must not
 * silently substitute Bot API or Android ACTION_SEND.
 */
interface TelegramCore {
    val events: Flow<TelegramEvent>
    suspend fun initialize(config: TelegramCoreConfig): Result<Unit>
    suspend fun submitPhoneNumber(phoneNumber: String): Result<Unit>
    suspend fun submitCode(code: String): Result<Unit>
    suspend fun submitPassword(password: String): Result<Unit>
    suspend fun getChats(limit: Int, offsetChatId: ChatId? = null): Result<List<TelegramChat>>
    suspend fun getHistory(chatId: ChatId, limit: Int, fromMessageId: MessageId? = null): Result<List<TelegramMessage>>
    suspend fun sendText(chatId: ChatId, text: String, replyTo: MessageId? = null): Result<MessageId>
    suspend fun sendPhoto(chatId: ChatId, localPath: String, caption: String? = null): Result<MessageId>
    suspend fun sendVideo(chatId: ChatId, localPath: String, caption: String? = null): Result<MessageId>
    suspend fun logout(deleteLocalSession: Boolean): Result<Unit>
}

data class TelegramCoreConfig(
    val apiId: Int,
    val apiHash: String,
    val databaseDirectory: String,
    val filesDirectory: String,
    val databaseEncryptionKey: ByteArray,
    val useTestDc: Boolean = false
) {
    init {
        require(apiId > 0) { "apiId must be a positive Telegram application ID" }
        require(apiHash.isNotBlank()) { "apiHash must be configured outside source control" }
        require(databaseDirectory.isNotBlank())
        require(filesDirectory.isNotBlank())
        require(databaseEncryptionKey.isNotEmpty()) { "TDLib database encryption key is required" }
    }
    override fun toString(): String =
        "TelegramCoreConfig(apiId=$apiId, apiHash=[REDACTED], databaseDirectory=[REDACTED], " +
        "filesDirectory=[REDACTED], databaseEncryptionKey=[REDACTED], useTestDc=$useTestDc)"
}
