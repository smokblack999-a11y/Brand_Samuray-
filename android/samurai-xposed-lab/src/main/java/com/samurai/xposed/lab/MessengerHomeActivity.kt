package com.samurai.xposed.lab

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.res.Configuration
import android.content.Intent
import android.net.Uri
import java.io.ByteArrayOutputStream
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.inputmethod.EditorInfo
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import android.text.Editable
import android.text.TextWatcher
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * SAMURAI's local-first messenger UI.
 *
 * This screen stores user-created chats and messages in a private SQLite DB.
 * It has no server transport in this build: local messages are not delivered
 * to WhatsApp or another device. The UI labels that boundary explicitly.
 */
class MessengerHomeActivity : Activity() {
    private lateinit var store: MessengerStore
    private lateinit var root: LinearLayout
    private val prefs by lazy { getSharedPreferences("samurai_lab_ui", Context.MODE_PRIVATE) }
    private var currentFilter = "Все"
    private var currentChatId: Long? = null
    private var activeTab = "Чаты"
    private var currentQuery = ""

    private var dark = true
    private var compact = false
    private var textScale = 1f
    private var accentId = "emerald"

    private val bg get() = if (dark) Color.rgb(9, 15, 23) else Color.rgb(244, 247, 251)
    private val surface get() = if (dark) Color.rgb(19, 28, 40) else Color.WHITE
    private val surfaceAlt get() = if (dark) Color.rgb(25, 37, 51) else Color.rgb(232, 238, 245)
    private val fg get() = if (dark) Color.rgb(239, 245, 250) else Color.rgb(24, 35, 48)
    private val muted get() = if (dark) Color.rgb(145, 163, 183) else Color.rgb(91, 107, 124)
    private val accent get() = when (accentId) {
        "cyan" -> Color.rgb(34, 211, 238)
        "violet" -> Color.rgb(167, 139, 250)
        "amber" -> Color.rgb(245, 185, 66)
        else -> Color.rgb(0, 217, 139)
    }
    private val timeFormat = SimpleDateFormat("HH:mm", Locale.getDefault())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = MessengerStore(this)
        loadAppearance()
        applySystemBars()
        showHome()
    }

    override fun onDestroy() {
        if (::store.isInitialized) store.close()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Android API; retained for platform back compatibility")
    override fun onBackPressed() {
        if (currentChatId != null) {
            currentChatId = null
            showHome()
        } else if (activeTab != "Чаты") {
            activeTab = "Чаты"
            showHome()
        } else {
            super.onBackPressed()
        }
    }


    @Deprecated("Deprecated platform callback retained for broad Android compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != RESULT_OK) return
        val uri = data?.data ?: return
        when (requestCode) {
            REQUEST_EXPORT_BACKUP -> exportBackup(uri)
            REQUEST_IMPORT_BACKUP -> importBackup(uri)
        }
    }

    private fun exportBackup(uri: Uri) {
        runCatching {
            val json = store.exportBackupJson()
            contentResolver.openOutputStream(uri)?.bufferedWriter(Charsets.UTF_8)?.use { it.write(json) }
                ?: error("Не удалось открыть файл для записи")
        }.onSuccess {
            Toast.makeText(this, "Резервная копия сохранена", Toast.LENGTH_LONG).show()
        }.onFailure {
            Toast.makeText(this, "Экспорт не выполнен: ${it.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun importBackup(uri: Uri) {
        runCatching {
            val input = contentResolver.openInputStream(uri) ?: error("Не удалось открыть файл")
            val output = ByteArrayOutputStream()
            input.use { stream ->
                val buffer = ByteArray(8 * 1024)
                var total = 0
                while (true) {
                    val count = stream.read(buffer)
                    if (count < 0) break
                    total += count
                    require(total <= 5 * 1024 * 1024) { "Резервная копия больше 5 МБ" }
                    output.write(buffer, 0, count)
                }
            }
            store.importBackupJson(output.toString(Charsets.UTF_8.name()))
        }.onSuccess { count ->
            Toast.makeText(this, "Импортировано новых сообщений: $count", Toast.LENGTH_LONG).show()
            showTab("Чаты")
        }.onFailure {
            Toast.makeText(this, "Импорт не выполнен: ${it.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun loadAppearance() {
        val mode = prefs.getString("theme", "system")
        dark = when (mode) {
            "dark" -> true
            "light" -> false
            else -> (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        }
        compact = prefs.getBoolean("compact", false)
        textScale = prefs.getFloat("text_scale", 1f).coerceIn(0.85f, 1.25f)
        accentId = prefs.getString("accent", "emerald") ?: "emerald"
    }

    private fun applySystemBars() {
        window.statusBarColor = bg
        window.navigationBarColor = bg
        window.decorView.systemUiVisibility = if (dark) 0 else
            (View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR)
    }

    private fun newRoot(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(bg)
        setPadding(dp(18), dp(14), dp(18), dp(8))
    }

    private fun showHome() {
        activeTab = "Чаты"
        currentChatId = null
        root = newRoot()
        setContentView(root)
        val header = row().apply { gravity = Gravity.CENTER_VERTICAL }
        val heading = column()
        label(heading, "SAMURAI", 11, accent, true)
        label(heading, "Сообщения", 27, fg, true)
        header.addView(heading, LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(actionButton("＋", "Новый диалог") { createChatDialog() }, LinearLayout.LayoutParams(dp(48), dp(48)))
        root.addView(header)

        val search = EditText(this).apply {
            hint = "Поиск диалогов и сообщений"
            setHintTextColor(muted)
            setTextColor(fg)
            textSize = 14f * textScale
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            setPadding(dp(15), 0, dp(15), 0)
            background = rounded(surfaceAlt, 15)
            setCompoundDrawablesWithIntrinsicBounds(android.R.drawable.ic_menu_search, 0, 0, 0)
            compoundDrawablePadding = dp(9)
        }
        root.addView(search, LinearLayout.LayoutParams(-1, dp(48)).apply {
            topMargin = dp(16); bottomMargin = dp(12)
        })

        val filtersScroll = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false }
        val filters = row()
        listOf("Все", "Непрочитанные", "Личные", "Группы").forEach { filter ->
            val selected = filter == currentFilter
            val chip = textView(filter, 12, if (selected) bg else muted, selected).apply {
                gravity = Gravity.CENTER
                setPadding(dp(14), dp(9), dp(14), dp(9))
                background = rounded(if (selected) accent else surface, 24)
                setOnClickListener {
                    currentFilter = filter
                    currentQuery = search.text.toString()
                    renderChatList(listContainer, currentQuery)
                    renderFilterRow(filters)
                }
            }
            filters.addView(chip, LinearLayout.LayoutParams(-2, dp(36)).apply { marginEnd = dp(7) })
        }
        filtersScroll.addView(filters)
        root.addView(filtersScroll, LinearLayout.LayoutParams(-1, dp(38)).apply { bottomMargin = dp(8) })

        listContainer = column()
        val scroll = ScrollView(this).apply { isFillViewport = true }
        scroll.addView(listContainer)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        renderChatList(listContainer, currentQuery)
        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                currentQuery = s?.toString().orEmpty()
                renderChatList(listContainer, currentQuery)
            }
            override fun afterTextChanged(s: Editable?) = Unit
        })
        root.addView(bottomNavigation())
        root.addView(localOnlyLabel())
    }

    private lateinit var listContainer: LinearLayout

    private fun renderFilterRow(filters: LinearLayout) {
        filters.removeAllViews()
        listOf("Все", "Непрочитанные", "Личные", "Группы").forEach { filter ->
            val selected = filter == currentFilter
            filters.addView(textView(filter, 12, if (selected) bg else muted, selected).apply {
                gravity = Gravity.CENTER
                setPadding(dp(14), dp(9), dp(14), dp(9))
                background = rounded(if (selected) accent else surface, 24)
                setOnClickListener {
                    currentFilter = filter
                    renderChatList(listContainer, currentQuery)
                    renderFilterRow(filters)
                }
            }, LinearLayout.LayoutParams(-2, dp(36)).apply { marginEnd = dp(7) })
        }
    }

    private fun renderChatList(target: LinearLayout, query: String) {
        target.removeAllViews()
        val allChats = store.getChats()
        val messagesByChat = allChats.associate { chat -> chat.id to store.getMessages(chat.id) }
        val chats = MessengerFilter.apply(allChats, messagesByChat, currentFilter, query)
        if (chats.isEmpty()) {
            emptyState(target, if (query.isBlank()) "Здесь пока нет диалогов" else "Ничего не найдено",
                if (query.isBlank()) "Создай первый локальный диалог кнопкой ＋" else "Измени поисковый запрос")
            return
        }
        chats.forEach { chat -> target.addView(chatRow(chat)) }
    }

    private fun chatRow(chat: LocalChat): View {
        val wrapper = column()
        val item = row().apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(if (compact) 9 else 13), 0, dp(if (compact) 9 else 13))
            setOnClickListener { openChat(chat.id) }
        }
        val avatar = textView(chat.initial, 18, fg, true).apply {
            gravity = Gravity.CENTER
            background = circle(avatarColor(chat.title))
        }
        item.addView(avatar, LinearLayout.LayoutParams(dp(52), dp(52)).apply { marginEnd = dp(13) })
        val details = column()
        val top = row().apply { gravity = Gravity.CENTER_VERTICAL }
        top.addView(textView(chat.title, 15, fg, true), LinearLayout.LayoutParams(0, -2, 1f))
        top.addView(textView(formatTime(chat.updatedAt), 10, muted, false))
        details.addView(top)
        val bottom = row().apply { gravity = Gravity.CENTER_VERTICAL }
        bottom.addView(textView((if (chat.pinned) "⌖  " else "") + chat.preview, 12, muted, false),
            LinearLayout.LayoutParams(0, -2, 1f))
        if (chat.unreadCount > 0) {
            bottom.addView(textView(chat.unreadCount.toString(), 10, bg, true).apply {
                gravity = Gravity.CENTER
                background = circle(accent)
            }, LinearLayout.LayoutParams(dp(22), dp(22)))
        }
        details.addView(bottom, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(5) })
        item.addView(details, LinearLayout.LayoutParams(0, -2, 1f))
        item.setOnLongClickListener {
            val popup = PopupMenu(this, item)
            popup.menu.add(if (chat.pinned) "Открепить" else "Закрепить").setOnMenuItemClickListener {
                store.togglePinned(chat.id); renderChatList(listContainer, ""); true
            }
            popup.menu.add("Открыть").setOnMenuItemClickListener { openChat(chat.id); true }
            popup.show()
            true
        }
        wrapper.addView(item)
        wrapper.addView(View(this).apply { setBackgroundColor(if (dark) Color.rgb(34, 46, 60) else Color.rgb(225, 232, 240)) },
            LinearLayout.LayoutParams(-1, dp(1)))
        return wrapper
    }

    private fun openChat(chatId: Long) {
        store.markRead(chatId)
        currentChatId = chatId
        showConversation(chatId)
    }

    private fun showConversation(chatId: Long) {
        val chat = store.getChats().firstOrNull { it.id == chatId } ?: run {
            showHome(); return
        }
        root = newRoot()
        root.setPadding(dp(12), dp(8), dp(12), dp(8))
        setContentView(root)

        val header = row().apply { gravity = Gravity.CENTER_VERTICAL }
        header.addView(textView("‹", 34, accent, false).apply {
            gravity = Gravity.CENTER
            setOnClickListener { showHome() }
        }, LinearLayout.LayoutParams(dp(40), dp(48)))
        val titleBlock = column()
        label(titleBlock, chat.title, 16, fg, true)
        label(titleBlock, if (chat.category == "group") "Групповой локальный диалог" else "Локальный диалог", 10, muted, false)
        header.addView(titleBlock, LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(textView("⋮", 24, fg, true).apply {
            gravity = Gravity.CENTER
            setPadding(dp(12), dp(8), dp(8), dp(8))
            setOnClickListener { chatMenu(chat) }
        })
        root.addView(header)

        val history = column().apply { setPadding(dp(2), dp(16), dp(2), dp(16)) }
        val scroll = ScrollView(this).apply { isFillViewport = true }
        scroll.addView(history)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        renderMessages(history, chatId)
        scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }

        val composer = row().apply {
            gravity = Gravity.CENTER_VERTICAL
            background = rounded(surface, 27)
            setPadding(dp(12), dp(4), dp(5), dp(4))
        }
        val input = EditText(this).apply {
            hint = "Сообщение"
            setHintTextColor(muted)
            setTextColor(fg)
            textSize = 14f * textScale
            maxLines = 4
            minHeight = dp(42)
            background = null
            imeOptions = EditorInfo.IME_ACTION_SEND
        }
        composer.addView(input, LinearLayout.LayoutParams(0, -2, 1f))
        val send = textView("➤", 18, bg, true).apply {
            gravity = Gravity.CENTER
            background = circle(accent)
        }
        composer.addView(send, LinearLayout.LayoutParams(dp(42), dp(42)))
        fun sendMessage() {
            val body = input.text?.toString().orEmpty()
            if (body.isBlank()) return
            runCatching { store.sendLocalMessage(chatId, body) }
                .onSuccess {
                    input.setText("")
                    renderMessages(history, chatId)
                    scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
                }
                .onFailure { Toast.makeText(this, it.message ?: "Не удалось сохранить", Toast.LENGTH_SHORT).show() }
        }
        send.setOnClickListener { sendMessage() }
        input.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_SEND) { sendMessage(); true } else false
        }
        root.addView(composer)
        root.addView(localOnlyLabel())
    }

    private fun renderMessages(target: LinearLayout, chatId: Long) {
        target.removeAllViews()
        val messages = store.getMessages(chatId)
        if (messages.isEmpty()) {
            emptyState(target, "Начни разговор", "Напиши первое сообщение ниже")
            return
        }
        messages.forEach { msg ->
            val line = row().apply { gravity = if (msg.fromMe) Gravity.END else Gravity.START }
            val bubble = column().apply {
                setPadding(dp(13), dp(9), dp(13), dp(7))
                background = rounded(if (msg.fromMe) {
                    if (dark) Color.rgb(0, 86, 67) else Color.rgb(211, 245, 231)
                } else surfaceAlt, 16)
            }
            label(bubble, msg.body, 14, if (msg.fromMe && !dark) Color.rgb(17, 69, 48) else fg, false)
            val meta = row().apply { gravity = Gravity.END or Gravity.CENTER_VERTICAL }
            meta.addView(textView(formatTime(msg.createdAt), 9, muted, false),
                LinearLayout.LayoutParams(-2, -2))
            if (msg.fromMe) {
                meta.addView(textView("  ✓ локально", 9,
                    if (dark) Color.rgb(161, 226, 207) else Color.rgb(21, 122, 83), false),
                    LinearLayout.LayoutParams(-2, -2))
            }
            bubble.addView(meta)
            line.addView(bubble, LinearLayout.LayoutParams(0, -2, 1f).apply {
                weight = 0f
                width = (resources.displayMetrics.widthPixels * 0.78f).toInt()
            })
            if (msg.fromMe) {
                bubble.setOnLongClickListener {
                    AlertDialog.Builder(this)
                        .setTitle("Удалить локальное сообщение?")
                        .setMessage("Оно будет удалено только из этого приложения на этом устройстве.")
                        .setNegativeButton("Отмена", null)
                        .setPositiveButton("Удалить") { _, _ ->
                            store.deleteLocalMessage(msg.id, chatId)
                            renderMessages(target, chatId)
                        }.show()
                    true
                }
            }
            target.addView(line, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) })
        }
    }

    private fun chatMenu(chat: LocalChat) {
        val popup = PopupMenu(this, root.getChildAt(0))
        popup.menu.add(if (chat.pinned) "Открепить чат" else "Закрепить чат").setOnMenuItemClickListener {
            store.togglePinned(chat.id); showConversation(chat.id); true
        }
        popup.menu.add("О чём этот режим").setOnMenuItemClickListener {
            AlertDialog.Builder(this).setTitle("Локальный режим")
                .setMessage("Сообщения хранятся в SQLite на этом устройстве. Сетевой транспорт и синхронизация в этой версии не подключены.")
                .setPositiveButton("Понятно", null).show()
            true
        }
        popup.show()
    }

    private fun createChatDialog() {
        val input = EditText(this).apply { hint = "Имя диалога"; setSingleLine(true) }
        val choices = arrayOf("Личный диалог", "Группа")
        var category = "personal"
        AlertDialog.Builder(this)
            .setTitle("Новый диалог")
            .setView(input)
            .setSingleChoiceItems(choices, 0) { _, which -> category = if (which == 0) "personal" else "group" }
            .setNegativeButton("Отмена", null)
            .setPositiveButton("Создать") { _, _ ->
                runCatching { store.createChat(input.text.toString(), category) }
                    .onSuccess { id -> currentFilter = "Все"; openChat(id) }
                    .onFailure { Toast.makeText(this, it.message ?: "Не удалось создать диалог", Toast.LENGTH_LONG).show() }
            }
            .show()
    }

    private fun bottomNavigation(): View {
        val bar = row().apply {
            gravity = Gravity.CENTER
            background = rounded(surface, 24)
            setPadding(dp(4), dp(5), dp(4), dp(5))
        }
        val tabs = listOf("Чаты" to "◉", "Контакты" to "♙", "Звонки" to "◌", "Профиль" to "⚙")
        tabs.forEach { (name, icon) ->
            val selected = activeTab == name
            val item = column().apply {
                gravity = Gravity.CENTER
                setPadding(dp(3), dp(6), dp(3), dp(6))
                setOnClickListener { activeTab = name; showTab(name) }
            }
            label(item, icon, 17, if (selected) accent else muted, selected)
            label(item, name, 10, if (selected) accent else muted, selected)
            bar.addView(item, LinearLayout.LayoutParams(0, -2, 1f))
        }
        return bar
    }

    private fun showTab(tab: String) {
        if (tab == "Чаты") { showHome(); return }
        root = newRoot()
        setContentView(root)
        val header = row().apply { gravity = Gravity.CENTER_VERTICAL }
        label(header, tab, 25, fg, true)
        root.addView(header)
        when (tab) {
            "Контакты" -> {
                val contacts = store.getChats().filter { it.category == "personal" }
                if (contacts.isEmpty()) emptyState(root, "Пока нет контактов", "Создай личный диалог, чтобы добавить локальную запись")
                contacts.forEach { chat -> root.addView(chatRow(chat)) }
                root.addView(actionButton("＋  Новый контакт / диалог", "Создать") { createChatDialog() })
            }
            "Звонки" -> emptyState(root, "История звонков пока пуста", "Аудио- и видеозвонки требуют отдельного сетевого сервиса и WebRTC. Они не имитируются.")
            "Профиль" -> showProfileSettings()
        }
        root.addView(View(this), LinearLayout.LayoutParams(0, 0, 1f))
        root.addView(bottomNavigation())
        root.addView(localOnlyLabel())
    }

    private fun showProfileSettings() {
        label(root, "Оформление SAMURAI", 17, fg, true)
        label(root, "Тема", 13, muted, true)
        listOf("system" to "Системная", "dark" to "Тёмная", "light" to "Светлая").forEach { (value, title) ->
            root.addView(actionButton(title, title) {
                prefs.edit().putString("theme", value).apply()
                loadAppearance(); applySystemBars(); showTab("Профиль")
            })
        }
        label(root, "Акцент", 13, muted, true)
        listOf("emerald" to "Emerald", "cyan" to "Cyber Cyan", "violet" to "Violet", "amber" to "Amber").forEach { (value, title) ->
            root.addView(actionButton(title, title) {
                prefs.edit().putString("accent", value).apply()
                loadAppearance(); applySystemBars(); showTab("Профиль")
            })
        }
        label(root, "Размер текста · ${(textScale * 100).toInt()}%", 13, muted, true)
        root.addView(SeekBar(this).apply {
            max = 40
            progress = ((textScale - 0.85f) * 100).toInt().coerceIn(0, 40)
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                    if (fromUser) {
                        textScale = 0.85f + progress / 100f
                        prefs.edit().putFloat("text_scale", textScale).apply()
                    }
                }
                override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
                override fun onStopTrackingTouch(seekBar: SeekBar?) { loadAppearance(); showTab("Профиль") }
            })
        })
        root.addView(actionButton(if (compact) "Отключить компактный режим" else "Включить компактный режим", "Плотность") {
            compact = !compact
            prefs.edit().putBoolean("compact", compact).apply()
            showTab("Профиль")
        })
        root.addView(actionButton("Сбросить оформление", "Сброс") {
            prefs.edit().clear().apply()
            loadAppearance(); applySystemBars(); showTab("Профиль")
        })
        label(root, "Резервное копирование", 15, fg, true)
        root.addView(actionButton("Экспортировать диалоги в JSON", "Создать резервную копию") {
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "application/json"
                putExtra(Intent.EXTRA_TITLE, "samurai-messenger-backup.json")
            }
            startActivityForResult(intent, REQUEST_EXPORT_BACKUP)
        })
        root.addView(actionButton("Восстановить из JSON", "Импортировать резервную копию") {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "application/json"
            }
            startActivityForResult(intent, REQUEST_IMPORT_BACKUP)
        })
        label(root, "Экспортированный JSON не зашифрован. Храни его в безопасном месте и не пересылай третьим лицам.", 11, muted, false)
        label(root, "Локальное хранилище", 15, fg, true)
        label(root, "Диалоги и сообщения сохраняются в приватной SQLite-базе этого телефона. Синхронизация с сервером и другими устройствами не подключена.", 12, muted, false)
    }

    private fun emptyState(parent: LinearLayout, title: String, detail: String) {
        val box = column().apply {
            gravity = Gravity.CENTER
            setPadding(dp(20), dp(34), dp(20), dp(34))
        }
        label(box, title, 17, fg, true)
        label(box, detail, 12, muted, false)
        parent.addView(box, LinearLayout.LayoutParams(-1, -2))
    }

    private fun localOnlyLabel() = textView("ЛОКАЛЬНЫЕ СООБЩЕНИЯ · НЕ ДОСТАВЛЯЮТСЯ В WHATSAPP", 9, muted, true).apply {
        gravity = Gravity.CENTER
        setPadding(0, dp(5), 0, dp(3))
    }

    private fun actionButton(title: String, description: String, action: () -> Unit): TextView =
        textView(title, 14, fg, true).apply {
            contentDescription = description
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(15), dp(13), dp(15), dp(13))
            background = rounded(surface, 14)
            setOnClickListener { action() }
        }

    private fun row() = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    private fun column() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

    private fun label(parent: LinearLayout, value: String, size: Int, color: Int, bold: Boolean) {
        val view = textView(value, size, color, bold)
        parent.addView(view, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(5) })
    }

    private fun textView(value: String, size: Int, color: Int, bold: Boolean) = TextView(this).apply {
        text = value
        textSize = size * textScale
        setTextColor(color)
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setLineSpacing(dp(2).toFloat(), 1f)
    }

    private fun rounded(color: Int, radius: Int) = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(radius).toFloat()
    }

    private fun circle(color: Int) = GradientDrawable().apply {
        shape = GradientDrawable.OVAL; setColor(color)
    }

    private fun avatarColor(seed: String): Int {
        val colors = listOf(
            Color.rgb(41, 92, 105), Color.rgb(85, 68, 124),
            Color.rgb(111, 79, 55), Color.rgb(43, 104, 76)
        )
        val hash = if (seed.hashCode() == Int.MIN_VALUE) 0 else kotlin.math.abs(seed.hashCode())
        return colors[hash % colors.size]
    }

    private fun formatTime(value: Long): String {
        val now = System.currentTimeMillis()
        return if (now - value < 24 * 60 * 60 * 1000L) timeFormat.format(Date(value))
        else SimpleDateFormat("dd.MM", Locale.getDefault()).format(Date(value))
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private companion object {
        const val REQUEST_EXPORT_BACKUP = 4101
        const val REQUEST_IMPORT_BACKUP = 4102
    }
}
