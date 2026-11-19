package com.samurai.xposed.lab

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

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
        // Version 1 is the first persistent local store. Future migrations must
        // be additive; never drop user-created local conversations automatically.
    }

    private fun seedDemoData(db: SQLiteDatabase) {
        val now = System.currentTimeMillis()
        val samples = listOf(
            Sample("Александр", "personal", "А", true, listOf(
                SampleMessage("Скинул документы, посмотри", false, now - 12 * 60_000L),
                SampleMessage("Хорошо, проверю", true, now - 8 * 60_000L)
            )),
            Sample("Команда SAMURAI", "group", "S", false, listOf(
                SampleMessage("Ирина: сборка готова к проверке", false, now - 32 * 60_000L)
            )),
            Sample("Мама", "personal", "М", false, listOf(
                SampleMessage("Не забудь позвонить", false, now - 54 * 60_000L)
            )),
            Sample("Доставка · Курьеры", "group", "Д", false, listOf(
                SampleMessage("Заказ #1042 доставлен", false, now - 95 * 60_000L)
            )),
            Sample("Денис", "personal", "Д", true, listOf(
                SampleMessage("Голосовое сообщение · 0:18", false, now - 24 * 60 * 60_000L)
            )),
            Sample("Избранное", "personal", "★", true, listOf(
                SampleMessage("Заметки и сохранённые сообщения", true, now - 3 * 24 * 60 * 60_000L)
            ))
        )
        samples.forEach { sample ->
            val values = ContentValues().apply {
                put("title", sample.title)
                put("initial", sample.initial)
                put("category", sample.category)
                put("pinned", if (sample.pinned) 1 else 0)
                put("unread_count", 0)
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

    private data class Sample(
        val title: String,
        val category: String,
        val initial: String,
        val pinned: Boolean,
        val messages: List<SampleMessage>
    )

    private data class SampleMessage(val body: String, val fromMe: Boolean, val time: Long)

    companion object {
        private const val DB_NAME = "samurai_messenger_local.db"
        private const val DB_VERSION = 1
    }
}
