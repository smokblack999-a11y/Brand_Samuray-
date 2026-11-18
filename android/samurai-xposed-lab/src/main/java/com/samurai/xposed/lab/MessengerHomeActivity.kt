package com.samurai.xposed.lab

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/**
 * SAMURAI Messenger UI concept.
 * Conversations are local demo data only; no WhatsApp account or network integration.
 */
class MessengerHomeActivity : Activity() {
    private val accent = Color.rgb(0, 217, 139)
    private val page = Color.rgb(9, 15, 23)
    private val panel = Color.rgb(19, 28, 40)
    private val panel2 = Color.rgb(25, 37, 51)
    private val primary = Color.rgb(239, 245, 250)
    private val secondary = Color.rgb(145, 163, 183)
    private val conversations = mutableListOf(
        DemoChat("Александр", "Скинул документы, посмотри", "17:42", 2, "А", true),
        DemoChat("Команда SAMURAI", "Ирина: сборка готова к проверке", "17:18", 5, "S", false),
        DemoChat("Мама", "Не забудь позвонить", "16:56", 0, "М", false),
        DemoChat("Доставка · Курьеры", "Заказ #1042 доставлен", "15:31", 0, "Д", false),
        DemoChat("Денис", "Голосовое сообщение · 0:18", "Вчера", 0, "Д", true),
        DemoChat("Избранное", "Заметки и сохранённые сообщения", "Пн", 0, "★", false)
    )
    private var activeFilter = "Все"
    private lateinit var root: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = page
        window.navigationBarColor = page
        window.decorView.systemUiVisibility = 0
        showHome()
    }

    private fun showHome(query: String = "") {
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(page)
            setPadding(dp(18), dp(18), dp(18), dp(8))
        }
        setContentView(root)

        val header = row()
        val brand = column()
        text(brand, "SAMURAI", 12, accent, true)
        text(brand, "Сообщения", 28, primary, true)
        header.addView(brand, LinearLayout.LayoutParams(0, -2, 1f))
        val compose = textView("＋", 29, page, true).apply {
            gravity = Gravity.CENTER
            background = circle(accent)
            setOnClickListener { Toast.makeText(this@MessengerHomeActivity, "Создание диалога будет подключено отдельно", Toast.LENGTH_SHORT).show() }
        }
        header.addView(compose, LinearLayout.LayoutParams(dp(48), dp(48)))
        root.addView(header)

        val search = EditText(this).apply {
            hint = "Поиск людей и сообщений"
            setHintTextColor(secondary)
            setTextColor(primary)
            textSize = 14f
            singleLine = true
            setPadding(dp(16), 0, dp(16), 0)
            background = rounded(panel2, 16)
            setCompoundDrawablesWithIntrinsicBounds(android.R.drawable.ic_menu_search, 0, 0, 0)
            compoundDrawablePadding = dp(10)
            setText(query)
        }
        root.addView(search, LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(18); bottomMargin = dp(14) })
        search.setOnEditorActionListener { _, _, _ -> showHome(search.text.toString()); true }

        val filters = row()
        listOf("Все", "Непрочитанные", "Личные", "Группы").forEach { filter ->
            val selected = filter == activeFilter
            val chip = textView(filter, 12, if (selected) page else secondary, selected).apply {
                gravity = Gravity.CENTER
                setPadding(dp(13), dp(9), dp(13), dp(9))
                background = rounded(if (selected) accent else panel, 24)
                setOnClickListener { activeFilter = filter; showHome(search.text.toString()) }
            }
            filters.addView(chip, LinearLayout.LayoutParams(-2, dp(36)).apply { marginEnd = dp(7) })
        }
        root.addView(filters, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(12) })

        val scroll = ScrollView(this)
        val list = column()
        val filtered = conversations.filter {
            val matches = it.name.contains(query, true) || it.preview.contains(query, true)
            val category = when (activeFilter) {
                "Непрочитанные" -> it.unread > 0
                "Личные" -> !it.name.contains("Команда") && !it.name.contains("Курьеры")
                "Группы" -> it.name.contains("Команда") || it.name.contains("Курьеры")
                else -> true
            }
            matches && category
        }
        filtered.forEach { chat -> list.addView(chatRow(chat)) }
        if (filtered.isEmpty()) {
            text(list, "Ничего не найдено", 15, secondary, false)
        }
        scroll.addView(list)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))

        val nav = row().apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, dp(5))
        }
        listOf("◉\nЧаты", "♙\nКонтакты", "◌\nЗвонки", "⚙\nПрофиль").forEachIndexed { index, title ->
            val item = textView(title, 11, if (index == 0) accent else secondary, index == 0).apply {
                gravity = Gravity.CENTER
                setPadding(0, dp(5), 0, dp(5))
                setOnClickListener {
                    if (index != 0) Toast.makeText(this@MessengerHomeActivity, "Раздел будет подключён следующим этапом", Toast.LENGTH_SHORT).show()
                }
            }
            nav.addView(item, LinearLayout.LayoutParams(0, dp(48), 1f))
        }
        root.addView(nav)
        val note = textView("ДЕМО-РЕЖИМ · ЛОКАЛЬНЫЕ ПРИМЕРЫ", 9, secondary, true).apply { gravity = Gravity.CENTER }
        root.addView(note, LinearLayout.LayoutParams(-1, dp(18)))
    }

    private fun chatRow(chat: DemoChat): View {
        val item = row().apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(12), 0, dp(12))
            setOnClickListener { showConversation(chat) }
        }
        val avatar = textView(chat.initial, 19, primary, true).apply {
            gravity = Gravity.CENTER
            background = circle(avatarColor(chat.initial))
        }
        item.addView(avatar, LinearLayout.LayoutParams(dp(52), dp(52)).apply { marginEnd = dp(13) })
        val details = column()
        val top = row()
        top.addView(textView(chat.name, 15, primary, true), LinearLayout.LayoutParams(0, -2, 1f))
        top.addView(textView(chat.time, 11, secondary, false))
        details.addView(top)
        val bottom = row().apply { gravity = Gravity.CENTER_VERTICAL }
        val preview = textView((if (chat.pinned) "⌖  " else "") + chat.preview, 12, secondary, false)
        bottom.addView(preview, LinearLayout.LayoutParams(0, -2, 1f))
        if (chat.unread > 0) {
            val count = textView(chat.unread.toString(), 10, page, true).apply {
                gravity = Gravity.CENTER
                background = circle(accent)
            }
            bottom.addView(count, LinearLayout.LayoutParams(dp(22), dp(22)))
        }
        details.addView(bottom, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(5) })
        item.addView(details, LinearLayout.LayoutParams(0, -2, 1f))
        val wrapper = column()
        wrapper.addView(item)
        wrapper.addView(View(this).apply { setBackgroundColor(Color.rgb(34, 46, 60)) }, LinearLayout.LayoutParams(-1, dp(1)))
        return wrapper
    }

    private fun showConversation(chat: DemoChat) {
        val screen = column().apply {
            setBackgroundColor(page)
            setPadding(dp(14), dp(12), dp(14), dp(10))
        }
        setContentView(screen)
        val header = row().apply { gravity = Gravity.CENTER_VERTICAL }
        val back = textView("‹", 34, accent, false).apply {
            gravity = Gravity.CENTER
            setOnClickListener { showHome() }
        }
        header.addView(back, LinearLayout.LayoutParams(dp(38), dp(48)))
        val title = column()
        text(title, chat.name, 16, primary, true)
        text(title, "Локальный демонстрационный диалог", 10, secondary, false)
        header.addView(title, LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(textView("⋮", 25, primary, true))
        screen.addView(header)

        val messages = column().apply { setPadding(0, dp(16), 0, dp(16)) }
        bubble(messages, "Привет! Это интерфейс SAMURAI.", false, "17:35")
        bubble(messages, "Здесь можно проверить внешний вид диалога, поиск и отправку локальных демо-сообщений.", false, "17:36")
        bubble(messages, "Понял. Сделай удобно и без лишних кнопок.", true, "17:38")
        val scroller = ScrollView(this)
        scroller.addView(messages)
        screen.addView(scroller, LinearLayout.LayoutParams(-1, 0, 1f))

        val composer = row().apply {
            gravity = Gravity.CENTER_VERTICAL
            background = rounded(panel, 28)
            setPadding(dp(12), dp(5), dp(6), dp(5))
        }
        val input = EditText(this).apply {
            hint = "Сообщение"
            setHintTextColor(secondary)
            setTextColor(primary)
            textSize = 14f
            background = null
            minHeight = dp(42)
        }
        composer.addView(input, LinearLayout.LayoutParams(0, -2, 1f))
        val send = textView("➤", 19, page, true).apply {
            gravity = Gravity.CENTER
            background = circle(accent)
            setOnClickListener {
                val value = input.text.toString().trim()
                if (value.isNotEmpty()) {
                    bubble(messages, value, true, "сейчас")
                    input.setText("")
                    scroller.post { scroller.fullScroll(View.FOCUS_DOWN) }
                }
            }
        }
        composer.addView(send, LinearLayout.LayoutParams(dp(42), dp(42)))
        screen.addView(composer)
        text(screen, "Сообщения сохраняются только в текущем демонстрационном экране", 9, secondary, false)
    }

    private fun bubble(target: LinearLayout, message: String, mine: Boolean, time: String) {
        val line = row().apply { gravity = if (mine) Gravity.END else Gravity.START }
        val body = column().apply {
            setPadding(dp(13), dp(9), dp(13), dp(7))
            background = rounded(if (mine) Color.rgb(0, 91, 70) else panel2, 16)
        }
        text(body, message, 14, primary, false)
        text(body, time, 9, if (mine) Color.rgb(177, 225, 210) else secondary, false)
        line.addView(body, LinearLayout.LayoutParams(-2, -2).apply { width = (resources.displayMetrics.widthPixels * 0.78f).toInt() })
        target.addView(line, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(9) })
    }

    private fun row() = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    private fun column() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    private fun text(parent: LinearLayout, value: String, size: Int, color: Int, bold: Boolean) {
        parent.addView(textView(value, size, color, bold), LinearLayout.LayoutParams(-1, -2))
    }
    private fun textView(value: String, size: Int, color: Int, bold: Boolean) = TextView(this).apply {
        text = value
        textSize = size.toFloat()
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
        val colors = listOf(Color.rgb(41, 92, 105), Color.rgb(85, 68, 124), Color.rgb(111, 79, 55), Color.rgb(43, 104, 76))
        return colors[(seed.hashCode().absoluteValue()) % colors.size]
    }
    private fun Int.absoluteValue() = if (this == Int.MIN_VALUE) 0 else kotlin.math.abs(this)
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private data class DemoChat(val name: String, val preview: String, val time: String, val unread: Int, val initial: String, val pinned: Boolean)
}
