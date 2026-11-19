package com.samuraios.app.messenger

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import org.json.JSONArray
import java.util.UUID
import java.net.URI
import java.util.concurrent.Executors

class MessengerActivity : Activity() {
    private val store by lazy { SecureStore(this) }
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val bg = Color.rgb(9, 15, 23)
    private val surface = Color.rgb(20, 29, 41)
    private val accent = Color.rgb(0, 217, 139)
    private val foreground = Color.rgb(238, 244, 250)
    private val muted = Color.rgb(150, 165, 183)
    private var api: MessengerApi? = null
    private var socket: WebSocket? = null
    private var currentConversation: MessengerApi.Conversation? = null
    private var currentSecret: String? = null
    private lateinit var root: LinearLayout
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = bg
        window.navigationBarColor = bg
        val base = getPreferences(MODE_PRIVATE).getString("api_base", null)
        if (base != null && store.accessToken() != null) {
            api = MessengerApi(base, store)
            loadHome()
        } else {
            showAuth()
        }
    }

    override fun onDestroy() {
        socket?.close(1000, "activity destroyed")
        io.shutdown()
        super.onDestroy()
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun column() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    private fun text(value: String, size: Float = 14f, color: Int = foreground, bold: Boolean = false) =
        TextView(this).apply {
            text = value
            textSize = size
            setTextColor(color)
            if (bold) setTypeface(typeface, Typeface.BOLD)
            setPadding(0, dp(5), 0, dp(5))
        }
    private fun field(hintText: String, password: Boolean = false) = EditText(this).apply {
        hint = hintText
        setHintTextColor(muted)
        setTextColor(this@MessengerActivity.foreground)
        textSize = 15f
        setSingleLine(true)
        setPadding(dp(14), dp(8), dp(14), dp(8))
        background = rounded(surface, 12)
        if (password) inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
    }
    private fun rounded(color: Int, radius: Int = 14) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radius).toFloat()
        setStroke(dp(1), Color.rgb(42, 57, 74))
    }
    private fun button(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        setOnClickListener { action() }
    }
    private fun mount(content: LinearLayout) {
        root = content
        root.setPadding(dp(18), dp(16), dp(18), dp(12))
        root.setBackgroundColor(bg)
        val scroll = ScrollView(this).apply { isFillViewport = true; addView(root) }
        setContentView(scroll)
    }
    private fun addTitle(title: String, subtitle: String) {
        root.addView(text("SAMURAI MESSENGER", 12f, accent, true))
        root.addView(text(title, 27f, foreground, true))
        root.addView(text(subtitle, 13f, muted))
    }
    private fun showStatus(value: String) {
        main.post { if (::status.isInitialized) status.text = value }
    }
    private fun report(error: Throwable) {
        val message = when (error) {
            is ApiException -> "API " + error.httpCode + ": " + error.message
            else -> error.message ?: error.javaClass.simpleName
        }
        main.post {
            Toast.makeText(this, message.take(220), Toast.LENGTH_LONG).show()
            showStatus(message.take(100))
        }
    }

    private fun showAuth() {
        mount(column())
        addTitle("Вход в аккаунт", "Собственный мессенджер · отдельный от WhatsApp")
        status = text("Не подключено", 12f, muted)
        root.addView(status)
        val base = field("HTTPS адрес API сервера")
        val username = field("Имя пользователя")
        val display = field("Имя в профиле (для регистрации)")
        val password = field("Пароль · минимум 12 символов", true)
        root.addView(base)
        root.addView(username)
        root.addView(display)
        root.addView(password)
        root.addView(text("Укажите сервер SAMURAI Messenger. Общий API-ключ в APK не вшивается.", 12f, muted))
        root.addView(button("ВОЙТИ") {
            authenticate(base.text.toString(), username.text.toString(), display.text.toString(), password.text.toString(), false)
        })
        root.addView(button("СОЗДАТЬ АККАУНТ") {
            authenticate(base.text.toString(), username.text.toString(), display.text.toString(), password.text.toString(), true)
        })
    }

    private fun authenticate(base: String, username: String, display: String, password: String, register: Boolean) {
        val normalized = base.trim().trimEnd('/')
        val validUrl = runCatching {
            val uri = URI(normalized)
            uri.host != null && (
                uri.scheme == "https" ||
                    (uri.scheme == "http" && (
                        uri.host == "10.0.2.2" ||
                            uri.host == "localhost" ||
                            uri.host.startsWith("192.168.") ||
                            uri.host.startsWith("10.")
                        ))
                )
        }.getOrDefault(false)
        if (!validUrl) { report(IllegalArgumentException("Нужен HTTPS URL; HTTP разрешён только для локальной сети")); return }
        if (username.length !in 3..32 || !username.matches(Regex("[A-Za-z0-9_]+"))) {
            report(IllegalArgumentException("Имя: 3–32 символа A-Z, 0-9, _")); return
        }
        if (password.length < 12) { report(IllegalArgumentException("Пароль минимум 12 символов")); return }
        if (register && display.trim().isEmpty()) { report(IllegalArgumentException("Введите имя профиля")); return }
        showStatus("Подключение…")
        io.execute {
            try {
                val candidate = MessengerApi(normalized, store)
                if (register) candidate.register(username, display, password) else candidate.login(username, password)
                getPreferences(MODE_PRIVATE).edit().putString("api_base", normalized).apply()
                api = candidate
                main.post { loadHome() }
            } catch (error: Throwable) { report(error) }
        }
    }

    private fun loadHome() {
        val client = api ?: return
        mount(column())
        addTitle("Сообщения", "Диалоги загружаются с сервера")
        status = text("Загрузка…", 12f, muted)
        root.addView(status)
        val peer = field("Имя пользователя собеседника")
        root.addView(peer)
        root.addView(button("НОВЫЙ ЛИЧНЫЙ ДИАЛОГ") {
            val name = peer.text.toString().trim()
            if (name.isEmpty()) { report(IllegalArgumentException("Введите имя пользователя")); return@button }
            io.execute {
                try {
                    val chat = client.createDirect(name)
                    main.post { openChat(chat) }
                } catch (error: Throwable) { report(error) }
            }
        })
        root.addView(button("ОБНОВИТЬ ДИАЛОГИ") { reloadConversations() })
        root.addView(button("НАСТРОЙКИ ПРИВАТНОСТИ") { loadPrivacy() })
        root.addView(button("ВЫЙТИ") {
            io.execute {
                runCatching { client.logout() }
                socket?.close(1000, "logout")
                main.post { api = null; showAuth() }
            }
        })
        root.addView(text("Аккаунт: @" + store.username().orEmpty(), 13f, accent))
        reloadConversations()
        connectRealtime()
        flushOutbox()
    }

    private fun reloadConversations() {
        val client = api ?: return
        io.execute {
            try {
                val conversations = client.conversations()
                main.post {
                    val oldList = root.findViewWithTag<LinearLayout>("conversation-list")
                    if (oldList != null) root.removeView(oldList)
                    val list = column().apply { tag = "conversation-list" }
                    list.addView(text("ВАШИ ДИАЛОГИ", 12f, accent, true))
                    conversations.forEach { chat ->
                        list.addView(button(chat.peerName + " · @" + chat.peerUsername) { openChat(chat) })
                    }
                    if (conversations.isEmpty()) list.addView(text("Пока нет диалогов. Начните с имени пользователя собеседника.", 13f, muted))
                    root.addView(list)
                    showStatus("Диалогов: " + conversations.size)
                }
            } catch (error: Throwable) { report(error) }
        }
    }

    private fun connectRealtime() {
        val client = api ?: return
        runCatching {
            socket?.close(1000, "reconnect")
            socket = client.connectRealtime(object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    showStatus("Realtime подключён")
                    flushOutbox()
                }
                override fun onMessage(webSocket: WebSocket, text: String) {
                    main.post {
                        if (currentConversation == null) reloadConversations() else refreshMessages()
                    }
                }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    showStatus("Realtime отключён · повтор через 5 секунд")
                    main.postDelayed({ if (!isFinishing && api != null) connectRealtime() }, 5000)
                }
            })
        }.onFailure { report(it) }
    }

    private fun loadPrivacy() {
        val client = api ?: return
        io.execute {
            try {
                val values = client.privacy()
                main.post {
                    mount(column())
                    addTitle("Приватность", "Управление собственными подтверждениями")
                    val read = CheckBox(this).apply {
                        text = "Отправлять отчёты о прочтении"
                        setTextColor(this@MessengerActivity.foreground)
                        isChecked = values.optBoolean("send_read_receipts", true)
                    }
                    val delivered = CheckBox(this).apply {
                        text = "Отправлять подтверждения доставки"
                        setTextColor(this@MessengerActivity.foreground)
                        isChecked = values.optBoolean("send_delivery_receipts", true)
                    }
                    val oneTick = CheckBox(this).apply {
                        text = "Всегда показывать одну галочку у моих сообщений"
                        setTextColor(this@MessengerActivity.foreground)
                        isChecked = getPreferences(MODE_PRIVATE).getBoolean("display_one_tick", false)
                    }
                    root.addView(read)
                    root.addView(delivered)
                    root.addView(oneTick)
                    root.addView(text("Одна галочка здесь — только локальный режим отображения. Реальные состояния сервера сохраняются отдельно; это не скрывает прочтение и не меняет квитанции собеседника.", 12f, muted))
                    root.addView(text("Публикация времени активности и присутствия пока не подключена.", 12f, muted))
                    root.addView(button("СОХРАНИТЬ") {
                        val update = JSONObject()
                            .put("send_read_receipts", read.isChecked)
                            .put("send_delivery_receipts", delivered.isChecked)
                        io.execute {
                            try {
                                client.updatePrivacy(update)
                                getPreferences(MODE_PRIVATE).edit().putBoolean("display_one_tick", oneTick.isChecked).apply()
                                main.post {
                                    Toast.makeText(this, "Настройки сохранены", Toast.LENGTH_SHORT).show()
                                    loadHome()
                                }
                            } catch (error: Throwable) { report(error) }
                        }
                    })
                    root.addView(button("НАЗАД") { loadHome() })
                }
            } catch (error: Throwable) { report(error) }
        }
    }

    private fun openChat(chat: MessengerApi.Conversation) {
        currentConversation = chat
        val saved = store.conversationSecret(chat.id)
        if (saved == null) {
            val input = field("Общий секрет · минимум 12 символов", true)
            mount(column())
            addTitle(chat.peerName, "Ключ локального шифрования")
            root.addView(text(
                "Оба участника должны вручную ввести одинаковый секрет, переданный вне приложения. Секрет хранится в Android Keystore. Потеря секрета означает потерю доступа к старым сообщениям. Это ранняя схема шифрования, не прошедшая независимый аудит.",
                13f, muted
            ))
            root.addView(input)
            root.addView(button("СОХРАНИТЬ КЛЮЧ И ОТКРЫТЬ") {
                val value = input.text.toString()
                if (value.length < 12) { report(IllegalArgumentException("Минимум 12 символов")); return@button }
                store.saveConversationSecret(chat.id, value)
                currentSecret = value
                showChat(chat)
            })
            root.addView(button("НАЗАД") { currentConversation = null; loadHome() })
        } else {
            currentSecret = saved
            showChat(chat)
        }
    }

    private fun showChat(chat: MessengerApi.Conversation) {
        mount(column())
        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        header.addView(text("‹", 30f, accent, true).apply {
            setOnClickListener { currentConversation = null; loadHome() }
        })
        val title = column()
        title.addView(text(chat.peerName, 19f, foreground, true))
        title.addView(text("@" + chat.peerUsername, 11f, muted))
        header.addView(title)
        root.addView(header)
        status = text("Подключение…", 11f, muted)
        root.addView(status)
        val messages = column().apply { tag = "messages" }
        val scroller = ScrollView(this).apply { addView(messages) }
        root.addView(scroller, LinearLayout.LayoutParams(-1, 0, 1f))
        val composer = field("Сообщение…")
        root.addView(composer)
        root.addView(button("ОТПРАВИТЬ") {
            val value = composer.text.toString().trim()
            val secret = currentSecret
            if (value.isEmpty() || secret == null) return@button
            val clientMessageId = UUID.randomUUID().toString()
            io.execute {
                try {
                    val encrypted = ConversationCrypto.encrypt(chat.id, secret, value)
                    enqueueOutbox(chat.id, clientMessageId, encrypted)
                    main.post { composer.setText(""); showStatus("Сообщение сохранено в защищённую очередь отправки") }
                    try {
                        api?.send(chat.id, encrypted, clientMessageId)
                        removeOutbox(clientMessageId)
                        refreshMessages()
                    } catch (sendError: Throwable) {
                        showStatus("Нет подтверждения сервера · сообщение сохранено локально")
                    }
                } catch (error: Throwable) { report(error) }
            }
        })
        root.addView(button("ОБНОВИТЬ / ПОВТОРИТЬ ОТПРАВКУ") { flushOutbox(); refreshMessages() })
        refreshMessages()
    }

    private fun enqueueOutbox(conversationId: String, id: String, encrypted: EncryptedMessage) {
        val array = JSONArray(store.readOutbox())
        array.put(JSONObject()
            .put("conversationId", conversationId)
            .put("clientMessageId", id)
            .put("ciphertext", encrypted.ciphertext)
            .put("nonce", encrypted.nonce))
        store.writeOutbox(array.toString())
    }

    private fun removeOutbox(id: String) {
        val current = JSONArray(store.readOutbox())
        val kept = JSONArray()
        for (index in 0 until current.length()) {
            val item = current.getJSONObject(index)
            if (item.optString("clientMessageId") != id) kept.put(item)
        }
        store.writeOutbox(kept.toString())
    }

    private fun flushOutbox() {
        val client = api ?: return
        io.execute {
            val current = JSONArray(store.readOutbox())
            for (index in 0 until current.length()) {
                val item = current.optJSONObject(index) ?: continue
                try {
                    val encrypted = EncryptedMessage(item.getString("ciphertext"), item.getString("nonce"))
                    client.send(item.getString("conversationId"), encrypted, item.getString("clientMessageId"))
                    removeOutbox(item.getString("clientMessageId"))
                } catch (_: Throwable) {
                    showStatus("Ожидает отправки: " + (current.length() - index))
                    break
                }
            }
            if (current.length() > 0 && store.readOutbox() == "[]") {
                showStatus("Очередь сообщений синхронизирована")
                if (currentConversation != null) refreshMessages()
            }
        }
    }

    private fun clientSend(conversationId: String, encrypted: EncryptedMessage) {
        api?.send(conversationId, encrypted) ?: throw ApiException(401, "Сессия завершена")
    }

    private fun refreshMessages() {
        val chat = currentConversation ?: return
        val secret = currentSecret ?: return
        val client = api ?: return
        io.execute {
            try {
                val values = client.messages(chat.id)
                values.filter { it.senderId != store.userId() }.forEach { message ->
                    runCatching {
                        client.acknowledgeDelivered(message.id)
                        client.acknowledgeRead(message.id)
                    }
                }
                val rendered = values.map { message ->
                    val plain = runCatching {
                        ConversationCrypto.decrypt(chat.id, secret, message.ciphertext, message.nonce)
                    }.getOrElse { "[Не удалось расшифровать — проверьте общий секрет]" }
                    val mine = message.senderId == store.userId()
                    val ticks = if (!mine) "" else if (getPreferences(MODE_PRIVATE).getBoolean("display_one_tick", false)) {
                        "  ✓ отправлено"
                    } else when {
                        message.readAt != null -> "  ✓✓ прочитано"
                        message.deliveredAt != null -> "  ✓✓ доставлено"
                        else -> "  ✓ принято сервером"
                    }
                    (if (mine) "Вы: " else chat.peerName + ": ") + plain + ticks
                }
                main.post {
                    val list = root.findViewWithTag<LinearLayout>("messages") ?: return@post
                    list.removeAllViews()
                    rendered.forEach { line ->
                        val item = text(line, 14f, foreground)
                        item.setPadding(dp(10), dp(8), dp(10), dp(8))
                        item.background = rounded(surface, 12)
                        list.addView(item, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(6) })
                    }
                    showStatus("Сообщений: " + values.size)
                }
            } catch (error: Throwable) { report(error) }
        }
    }
}
