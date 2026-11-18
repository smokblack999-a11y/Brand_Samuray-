package com.samurai.xposed.lab

import android.app.Activity
import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast

/**
 * Standalone, usable dashboard for Samsung/Android devices.
 * Appearance preferences are local to this app and never modify WhatsApp settings.
 */
class LabDashboardActivity : Activity() {
    private val prefs by lazy { getSharedPreferences("samurai_lab_ui", Context.MODE_PRIVATE) }
    private var accent = ACCENTS[0]
    private var compact = false
    private var textScale = 1.0f
    private var dark = true
    private lateinit var root: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        val mode = getSharedPreferences("samurai_lab_ui", MODE_PRIVATE).getString("theme", "system")
        val useDark = when (mode) {
            "dark" -> true
            "light" -> false
            else -> (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        }
        setTheme(if (useDark) android.R.style.Theme_Material_NoActionBar else android.R.style.Theme_Material_Light_NoActionBar)
        super.onCreate(savedInstanceState)

        dark = useDark
        accent = ACCENTS.firstOrNull { it.id == prefs.getString("accent", "emerald") } ?: ACCENTS[0]
        compact = prefs.getBoolean("compact", false)
        textScale = prefs.getFloat("text_scale", 1.0f).coerceIn(0.85f, 1.25f)
        buildScreen()
    }

    private val bg get() = if (dark) Color.rgb(10, 15, 23) else Color.rgb(244, 247, 251)
    private val surface get() = if (dark) Color.rgb(20, 29, 41) else Color.WHITE
    private val fg get() = if (dark) Color.rgb(235, 242, 250) else Color.rgb(22, 32, 46)
    private val muted get() = if (dark) Color.rgb(157, 173, 191) else Color.rgb(94, 111, 130)
    private val accentColor get() = Color.parseColor(accent.hex)

    private fun buildScreen() {
        val scroll = ScrollView(this).apply { setBackgroundColor(bg); isFillViewport = true }
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(24), dp(20), dp(32))
        }
        scroll.addView(root)
        setContentView(scroll)

        label("SAMURAI", 13f, accentColor, true)
        label("Xposed Control Center", 27f, fg, true)
        label("Локальная панель управления лабораторией", 14f, muted)
        card {
            label("СОСТОЯНИЕ МОДУЛЯ", 12f, accentColor, true)
            label("Диагностический режим", 20f, fg, true)
            label("Панель запускается независимо от LSPosed. Для загрузки модуля в WhatsApp нужен root и совместимый LSPosed.", 14f, muted)
            pill("HOOKS DISABLED · SAFE MODE", accentColor)
        }
        card {
            label("СОВМЕСТИМОСТЬ", 12f, accentColor, true)
            label("Samsung Galaxy A54 / Android", 18f, fg, true)
            label("Это целевой профиль интерфейса, а не подтверждение работы Xposed на устройстве. Точная версия WhatsApp будет определена модулем при загрузке.", 14f, muted)
            label("Проверка устройства: не выполнена", 13f, muted)
        }
        card {
            label("ВНЕШНИЙ ВИД", 12f, accentColor, true)
            label("Тема приложения", 18f, fg, true)
            val themeGroup = RadioGroup(this).apply { orientation = RadioGroup.VERTICAL }
            val currentTheme = prefs.getString("theme", "system")
            listOf("system" to "Как в системе", "dark" to "Тёмная", "light" to "Светлая").forEach { (value, title) ->
                val radio = RadioButton(this).apply {
                    text = title; textSize = 15f; setTextColor(fg); isChecked = currentTheme == value
                    setPadding(0, dp(4), 0, dp(4)); tag = value
                }
                themeGroup.addView(radio)
            }
            themeGroup.setOnCheckedChangeListener { group, checkedId ->
                val value = group.findViewById<RadioButton>(checkedId)?.tag as? String ?: "system"
                prefs.edit().putString("theme", value).apply()
                recreate()
            }
            root.addView(themeGroup)

            label("Акцентный цвет", 15f, fg, true)
            val accents = RadioGroup(this).apply { orientation = RadioGroup.VERTICAL }
            ACCENTS.forEach { item ->
                val radio = RadioButton(this).apply {
                    text = item.name; textSize = 14f; setTextColor(Color.parseColor(item.hex))
                    isChecked = item.id == accent.id; tag = item.id
                }
                accents.addView(radio)
            }
            accents.setOnCheckedChangeListener { group, checkedId ->
                val id = group.findViewById<RadioButton>(checkedId)?.tag as? String ?: return@setOnCheckedChangeListener
                prefs.edit().putString("accent", id).apply()
                accent = ACCENTS.first { it.id == id }
                buildScreen()
            }
            root.addView(accents)

            label("Размер текста · ${(textScale * 100).toInt()}%", 15f, fg, true)
            val scale = SeekBar(this).apply {
                max = 40; progress = ((textScale - 0.85f) * 100).toInt().coerceIn(0, 40)
                contentDescription = "Размер текста"
            }
            scale.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(bar: SeekBar?, progress: Int, fromUser: Boolean) {
                    if (fromUser) {
                        textScale = 0.85f + progress / 100f
                        prefs.edit().putFloat("text_scale", textScale).apply()
                    }
                }
                override fun onStartTrackingTouch(bar: SeekBar?) = Unit
                override fun onStopTrackingTouch(bar: SeekBar?) { buildScreen() }
            })
            root.addView(scale)
            val compactButton = Button(this).apply {
                text = if (compact) "Включён компактный режим" else "Включить компактный режим"
                setOnClickListener {
                    compact = !compact
                    prefs.edit().putBoolean("compact", compact).apply()
                    buildScreen()
                }
            }
            root.addView(compactButton)
        }
        card {
            label("КОНФИДЕНЦИАЛЬНОСТЬ И ГРАНИЦЫ", 12f, accentColor, true)
            label("Что умеет эта сборка", 18f, fg, true)
            label("• Определяет пакет, процесс и версию клиента.\n• Не читает переписки, контакты или медиа.\n• Не меняет чужие статусы и квитанции.\n• Не обходит View Once и удаление сообщений.\n• Не выдаёт локальную галочку за реальный статус доставки.", 14f, muted)
        }
        card {
            label("СЛЕДУЮЩИЕ ЭТАПЫ", 12f, accentColor, true)
            statusLine("Тема, акцент и масштаб текста", "ГОТОВО")
            statusLine("Диагностика версии WhatsApp", "КАРКАС ГОТОВ")
            statusLine("Тест на A54 с LSPosed", "ОЖИДАЕТ ТЕЛЕФОН")
            statusLine("Собственные настройки квитанций", "НЕ РЕАЛИЗОВАНО")
        }
        val reset = Button(this).apply {
            text = "Сбросить оформление"
            setOnClickListener {
                prefs.edit().clear().apply()
                Toast.makeText(this@LabDashboardActivity, "Оформление сброшено", Toast.LENGTH_SHORT).show()
                recreate()
            }
        }
        root.addView(reset, matchWidth())
        label("SAMURAI X10 · LAB BUILD 0.2", 12f, muted)
    }

    private fun card(content: LinearLayout.() -> Unit) {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(if (compact) 12 else 18), dp(18), dp(if (compact) 12 else 18))
            background = GradientDrawable().apply {
                setColor(surface); cornerRadius = dp(20).toFloat()
                setStroke(dp(1), if (dark) Color.rgb(39, 53, 70) else Color.rgb(225, 232, 240))
            }
        }
        box.content()
        val lp = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(if (compact) 10 else 16) }
        root.addView(box, lp)
    }

    private fun label(text: String, size: Float, color: Int, bold: Boolean = false) {
        val view = TextView(this).apply {
            this.text = text
            textSize = size * textScale
            setTextColor(color)
            if (bold) setTypeface(typeface, Typeface.BOLD)
            setLineSpacing(dp(3).toFloat(), 1.0f)
            contentDescription = text
        }
        root.addView(view, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) })
    }

    private fun LinearLayout.label(text: String, size: Float, color: Int, bold: Boolean = false) {
        val view = TextView(this@LabDashboardActivity).apply {
            this.text = text; textSize = size * textScale; setTextColor(color)
            if (bold) setTypeface(typeface, Typeface.BOLD)
            setLineSpacing(dp(3).toFloat(), 1.0f)
        }
        addView(view, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) })
    }

    private fun pill(text: String, color: Int) {
        val view = TextView(this).apply {
            this.text = text; textSize = 11f; setTextColor(color)
            setPadding(dp(10), dp(7), dp(10), dp(7))
            background = GradientDrawable().apply {
                setColor(if (dark) Color.rgb(24, 53, 54) else Color.rgb(225, 247, 239))
                cornerRadius = dp(30).toFloat()
            }
        }
        root.addView(view, LinearLayout.LayoutParams(-2, -2))
    }

    private fun statusLine(name: String, status: String) {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val left = TextView(this).apply { text = name; textSize = 13f; setTextColor(fg) }
        val right = TextView(this).apply { text = status; textSize = 10f; setTextColor(accentColor); setTypeface(typeface, Typeface.BOLD) }
        row.addView(left, LinearLayout.LayoutParams(0, -2, 1f))
        row.addView(right)
        root.addView(row, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) })
    }

    private fun matchWidth() = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(16) }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private data class Accent(val id: String, val name: String, val hex: String)
    private companion object {
        val ACCENTS = listOf(
            Accent("emerald", "Samurai Emerald", "#00D98B"),
            Accent("cyan", "Cyber Cyan", "#22D3EE"),
            Accent("violet", "Neural Violet", "#A78BFA"),
            Accent("amber", "Titanium Amber", "#F5B942")
        )
    }
}
