package com.samurai.xposed.lab

import org.junit.Assert.assertEquals
import org.junit.Test

class MessengerFilterTest {
    private val chats = listOf(
        LocalChat(1, "Александр", "А", "personal", true, 2, 100L, "Документы готовы"),
        LocalChat(2, "Команда SAMURAI", "S", "group", false, 0, 90L, "Сборка готова"),
        LocalChat(3, "Мама", "М", "personal", false, 0, 80L, "Позвони")
    )

    private val messages = mapOf(
        1L to listOf(LocalMessage(1, 1, "Отправил документы", 100L, false)),
        2L to listOf(LocalMessage(2, 2, "Проверить APK", 90L, false)),
        3L to listOf(LocalMessage(3, 3, "Не забудь позвонить", 80L, false))
    )

    @Test
    fun allFilterReturnsAllMatchingChats() {
        assertEquals(listOf(1L, 2L, 3L), MessengerFilter.apply(chats, messages, "Все", "").map { it.id })
    }

    @Test
    fun unreadFilterReturnsOnlyUnreadChats() {
        assertEquals(listOf(1L), MessengerFilter.apply(chats, messages, "Непрочитанные", "").map { it.id })
    }

    @Test
    fun personalAndGroupFiltersAreSeparated() {
        assertEquals(listOf(1L, 3L), MessengerFilter.apply(chats, messages, "Личные", "").map { it.id })
        assertEquals(listOf(2L), MessengerFilter.apply(chats, messages, "Группы", "").map { it.id })
    }

    @Test
    fun searchMatchesMessageBodyCaseInsensitively() {
        assertEquals(listOf(2L), MessengerFilter.apply(chats, messages, "Все", "проверить apk").map { it.id })
    }

    @Test
    fun searchMatchesChatTitleAndPreview() {
        assertEquals(listOf(1L), MessengerFilter.apply(chats, messages, "Все", "АЛЕКСАНДР").map { it.id })
        assertEquals(listOf(2L), MessengerFilter.apply(chats, messages, "Все", "сборка").map { it.id })
    }

    @Test
    fun whitespaceOnlySearchIsTreatedAsEmpty() {
        assertEquals(3, MessengerFilter.apply(chats, messages, "Все", "   ").size)
    }
}
