package com.samurai.xposed.lab

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject

internal data class LocalChat(
    val id: Long,
    val title: String,
    val initial: String,
    val category: String,
    val pinned: Boolean,
    val unreadCount: Int,
    val updatedAt: Long,
    val preview: String
)

internal data class LocalMessage(
    val id: Long,
    val chatId: Long,
    val body: String,
    val createdAt: Long,
    val fromMe: Boolean
)

/**
 * Private on-device conversation store.
 * No network transport is configured; messages never leave this application.
 */
internal class MessengerStore(context: Context) :
    SQLiteOpenHelper(context.applicationContext, DB_NAME, null, DB_VERSION) {

    override fun onConfigure(db: SQLiteDatabase) {
        super.onConfigure(db)
        db.setForeignKeyConstraintsEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL COLLATE NOCASE UNIQUE,
                initial TEXT NOT NULL,
                category TEXT NOT NULL CHECK(category IN ('personal','group')),
                pinned INTEGER NOT NULL DEFAULT 0,
                unread_count INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE TABLE messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
                body TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                from_me INTEGER NOT NULL CHECK(from_me IN (0,1))
            )
            """.trimIndent()
        )
        db.execSQL("CREATE INDEX idx_messages_chat_time ON messages(chat_id, created_at, id)")
        seedDemoData(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            // Seed demo unread badges for existing prototype installations.
            db.execSQL("UPDATE chats SET unread_count = 2 WHERE title = 'Александр' AND unread_count = 0")
            db.execSQL("UPDATE chats SET unread_count = 5 WHERE title = 'Команда SAMURAI' AND unread_count = 0")
        }
        // Future migrations must be additive; never drop user-created local
        // conversations or message history automatically.
    }

    private fun seedDemoData(db: SQLiteDatabase) {
        val now = System.currentTimeMillis()
        val samples = listOf(
            Sample("Александр", "personal", "А", true, 2, listOf(
                SampleMessage("Скинул документы, посмотри", false, now - 12 * 60_000L),
                SampleMessage("Хорошо, проверю", true, now - 8 * 60_000L)
            )),
            Sample("Команда SAMURAI", "group", "S", false, 5, listOf(
                SampleMessage("Ирина: сборка готова к проверке", false, now - 32 * 60_000L)
            )),
            Sample("Мама", "personal", "М", false, 0, listOf(
                SampleMessage("Не забудь позвонить", false, now - 54 * 60_000L)
            )),
            Sample("Доставка · Курьеры", "group", "Д", false, 0, listOf(
                SampleMessage("Заказ #1042 доставлен", false, now - 95 * 60_000L)
            )),
            Sample("Денис", "personal", "Д", true, 0, listOf(
                SampleMessage("Голосовое сообщение · 0:18", false, now - 24 * 60 * 60_000L)
            )),
            Sample("Избранное", "personal", "★", true, 0, listOf(
                SampleMessage("Заметки и сохранённые сообщения", true, now - 3 * 24 * 60 * 60_000L)
            ))
        )
        samples.forEach { sample ->
            val values = ContentValues().apply {
                put("title", sample.title)
                put("initial", sample.initial)
                put("category", sample.category)
                put("pinned", if (sample.pinned) 1 else 0)
                put("unread_count", sample.unreadCount)
                put("updated_at", sample.messages.last().time)
            }
            val chatId = db.insertOrThrow("chats", null, values)
            sample.messages.forEach { message ->
                val messageValues = ContentValues().apply {
                    put("chat_id", chatId)
                    put("body", message.body)
                    put("created_at", message.time)
                    put("from_me", if (message.fromMe) 1 else 0)
                }
                db.insertOrThrow("messages", null, messageValues)
            }
        }
    }

    fun getChats(): List<LocalChat> {
        val sql = """
            SELECT c.id, c.title, c.initial, c.category, c.pinned, c.unread_count, c.updated_at,
                COALESCE((
                    SELECT m.body FROM messages m
                    WHERE m.chat_id = c.id
                    ORDER BY m.created_at DESC, m.id DESC LIMIT 1
                ), 'Начните общение') AS preview
            FROM chats c
            ORDER BY c.pinned DESC, c.updated_at DESC, c.id DESC
        """.trimIndent()
        return readableDatabase.rawQuery(sql, null).use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    add(
                        LocalChat(
                            id = cursor.getLong(0),
                            title = cursor.getString(1),
                            initial = cursor.getString(2),
                            category = cursor.getString(3),
                            pinned = cursor.getInt(4) == 1,
                            unreadCount = cursor.getInt(5),
                            updatedAt = cursor.getLong(6),
                            preview = cursor.getString(7)
                        )
                    )
                }
            }
        }
    }

    fun getMessages(chatId: Long): List<LocalMessage> {
        return readableDatabase.query(
            "messages",
            arrayOf("id", "chat_id", "body", "created_at", "from_me"),
            "chat_id = ?",
            arrayOf(chatId.toString()),
            null,
            null,
            "created_at ASC, id ASC"
        ).use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    add(
                        LocalMessage(
                            id = cursor.getLong(0),
                            chatId = cursor.getLong(1),
                            body = cursor.getString(2),
                            createdAt = cursor.getLong(3),
                            fromMe = cursor.getInt(4) == 1
                        )
                    )
                }
            }
        }
    }

    fun createChat(title: String, category: String = "personal"): Long {
        val cleanTitle = title.trim().take(80)
        require(cleanTitle.isNotEmpty()) { "Введите название диалога" }
        require(category == "personal" || category == "group") { "Некорректный тип диалога" }
        val values = ContentValues().apply {
            put("title", cleanTitle)
            put("initial", cleanTitle.take(1).uppercase())
            put("category", category)
            put("pinned", 0)
            put("unread_count", 0)
            put("updated_at", System.currentTimeMillis())
        }
        return writableDatabase.insertOrThrow("chats", null, values)
    }

    fun sendLocalMessage(chatId: Long, body: String): Long {
        val cleanBody = body.trim().take(8_000)
        require(cleanBody.isNotEmpty()) { "Пустое сообщение нельзя сохранить" }
        val now = System.currentTimeMillis()
        val db = writableDatabase
        db.beginTransaction()
        try {
            val values = ContentValues().apply {
                put("chat_id", chatId)
                put("body", cleanBody)
                put("created_at", now)
                put("from_me", 1)
            }
            val messageId = db.insertOrThrow("messages", null, values)
            db.update(
                "chats",
                ContentValues().apply { put("updated_at", now) },
                "id = ?",
                arrayOf(chatId.toString())
            )
            db.setTransactionSuccessful()
            return messageId
        } finally {
            db.endTransaction()
        }
    }

    fun markRead(chatId: Long) {
        writableDatabase.update(
            "chats",
            ContentValues().apply { put("unread_count", 0) },
            "id = ?",
            arrayOf(chatId.toString())
        )
    }

    fun togglePinned(chatId: Long) {
        writableDatabase.execSQL(
            "UPDATE chats SET pinned = CASE pinned WHEN 1 THEN 0 ELSE 1 END WHERE id = ?",
            arrayOf(chatId)
        )
    }

    fun deleteLocalMessage(messageId: Long, chatId: Long) {
        writableDatabase.delete(
            "messages",
            "id = ? AND chat_id = ? AND from_me = 1",
            arrayOf(messageId.toString(), chatId.toString())
        )
    }


    fun exportBackupJson(): String {
        val root = JSONObject()
            .put("schema_version", 1)
            .put("exported_at", System.currentTimeMillis())
        val chatsJson = JSONArray()
        getChats().forEach { chat ->
            val chatJson = JSONObject()
                .put("title", chat.title)
                .put("category", chat.category)
                .put("pinned", chat.pinned)
            val messagesJson = JSONArray()
            getMessages(chat.id).forEach { message ->
                messagesJson.put(
                    JSONObject()
                        .put("body", message.body)
                        .put("created_at", message.createdAt)
                        .put("from_me", message.fromMe)
                )
            }
            chatJson.put("messages", messagesJson)
            chatsJson.put(chatJson)
        }
        root.put("chats", chatsJson)
        return root.toString(2)
    }

    /**
     * Merges a user-selected backup into the current local database.
     * It validates schema/size/counts and skips exact duplicate local messages.
     * No import data is sent over the network.
     */
    fun importBackupJson(raw: String): Int {
        require(raw.toByteArray(Charsets.UTF_8).size <= MAX_BACKUP_BYTES) {
            "Резервная копия больше 5 МБ"
        }
        val root = JSONObject(raw)
        require(root.optInt("schema_version", -1) == 1) {
            "Неподдерживаемая версия резервной копии"
        }
        val chats = root.optJSONArray("chats") ?: JSONArray()
        require(chats.length() <= MAX_BACKUP_CHATS) { "Слишком много диалогов в копии" }

        val db = writableDatabase
        var importedMessages = 0
        var totalMessages = 0
        db.beginTransaction()
        try {
            for (i in 0 until chats.length()) {
                val item = chats.optJSONObject(i) ?: continue
                val title = item.optString("title").trim().take(80)
                if (title.isEmpty()) continue
                val category = item.optString("category", "personal")
                    .takeIf { it == "personal" || it == "group" } ?: "personal"

                val existingId = db.rawQuery(
                    "SELECT id FROM chats WHERE title = ? COLLATE NOCASE LIMIT 1",
                    arrayOf(title)
                ).use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else null }

                val chatId = existingId ?: db.insertOrThrow(
                    "chats",
                    null,
                    ContentValues().apply {
                        put("title", title)
                        put("initial", title.take(1).uppercase())
                        put("category", category)
                        put("pinned", if (item.optBoolean("pinned")) 1 else 0)
                        put("unread_count", 0)
                        put("updated_at", System.currentTimeMillis())
                    }
                )

                val messages = item.optJSONArray("messages") ?: JSONArray()
                totalMessages += messages.length()
                require(totalMessages <= MAX_BACKUP_MESSAGES) {
                    "В резервной копии слишком много сообщений"
                }

                for (messageIndex in 0 until messages.length()) {
                    val message = messages.optJSONObject(messageIndex) ?: continue
                    val body = message.optString("body").trim()
                    if (body.isEmpty() || body.length > 8_000) continue
                    val createdAt = message.optLong("created_at", 0L)
                        .takeIf { it > 0L } ?: System.currentTimeMillis()
                    val fromMe = message.optBoolean("from_me", false)

                    val exists = db.rawQuery(
                        """
                        SELECT 1 FROM messages
                        WHERE chat_id = ? AND body = ? AND created_at = ? AND from_me = ?
                        LIMIT 1
                        """.trimIndent(),
                        arrayOf(chatId.toString(), body, createdAt.toString(), if (fromMe) "1" else "0")
                    ).use { it.moveToFirst() }

                    if (!exists) {
                        db.insertOrThrow(
                            "messages",
                            null,
                            ContentValues().apply {
                                put("chat_id", chatId)
                                put("body", body)
                                put("created_at", createdAt)
                                put("from_me", if (fromMe) 1 else 0)
                            }
                        )
                        importedMessages++
                    }
                }
                db.execSQL(
                    "UPDATE chats SET updated_at = MAX(updated_at, ?) WHERE id = ?",
                    arrayOf(System.currentTimeMillis(), chatId)
                )
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        return importedMessages
    }

    private data class Sample(
        val title: String,
        val category: String,
        val initial: String,
        val pinned: Boolean,
        val unreadCount: Int,
        val messages: List<SampleMessage>
    )

    private data class SampleMessage(val body: String, val fromMe: Boolean, val time: Long)

    companion object {
        private const val DB_NAME = "samurai_messenger_local.db"
        private const val DB_VERSION = 2
        private const val MAX_BACKUP_BYTES = 5 * 1024 * 1024
        private const val MAX_BACKUP_CHATS = 500
        private const val MAX_BACKUP_MESSAGES = 50_000
    }
}
