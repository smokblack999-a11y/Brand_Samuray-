package com.samurai.xposed.lab

internal object MessengerFilter {
    fun apply(
        chats: List<LocalChat>,
        messagesByChat: Map<Long, List<LocalMessage>>,
        filter: String,
        query: String
    ): List<LocalChat> {
        val normalizedQuery = query.trim()
        return chats.filter { chat ->
            val categoryMatches = when (filter) {
                "Непрочитанные" -> chat.unreadCount > 0
                "Личные" -> chat.category == "personal"
                "Группы" -> chat.category == "group"
                else -> true
            }
            if (!categoryMatches) return@filter false
            if (normalizedQuery.isEmpty()) return@filter true

            val chatMatches = chat.title.contains(normalizedQuery, ignoreCase = true) ||
                chat.preview.contains(normalizedQuery, ignoreCase = true)
            val messageMatches = messagesByChat[chat.id].orEmpty().any {
                it.body.contains(normalizedQuery, ignoreCase = true)
            }
            chatMatches || messageMatches
        }
    }
}
