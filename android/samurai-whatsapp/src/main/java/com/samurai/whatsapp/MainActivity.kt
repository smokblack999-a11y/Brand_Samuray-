package com.samurai.whatsapp

import android.app.Activity
import android.app.AlertDialog
import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.text.format.DateFormat
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.Date

class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var archiveView: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        render()
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) refresh()
    }

    private fun render() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 28, 24, 24)
            setBackgroundColor(0xFF080D13.toInt())
        }

        val heading = TextView(this).apply {
            text = "SAMURAI WHATSAPP"
            textSize = 24f
            setTextColor(0xFF00E68A.toInt())
            gravity = Gravity.CENTER
        }
        root.addView(heading)

        val subtitle = TextView(this).apply {
            text = "HYBRID PROTOTYPE · V1"
            textSize = 12f
            setTextColor(0xFF9AA8B5.toInt())
            gravity = Gravity.CENTER
            setPadding(0, 6, 0, 20)
        }
        root.addView(subtitle)

        status = TextView(this).apply {
            textSize = 14f
            setTextColor(0xFFFFFFFF.toInt())
            setPadding(12, 14, 12, 14)
            setBackgroundColor(0xFF14212B.toInt())
        }
        root.addView(status)

        root.addView(actionButton("РАЗРЕШИТЬ АРХИВ УВЕДОМЛЕНИЙ") {
            AlertDialog.Builder(this)
                .setTitle("Доступ к уведомлениям")
                .setMessage(
                    "Android позволит SAMURAI сохранять видимый текст уведомлений WhatsApp " +
                        "в зашифрованный локальный архив. Содержимое останется на этом устройстве. " +
                        "Это не перехватывает сообщения внутри WhatsApp и не сохраняет View Once."
                )
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Открыть настройки") { _, _ ->
                    startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                }
                .show()
        })

        root.addView(actionButton("ОБНОВИТЬ АРХИВ") { refresh() })
        root.addView(actionButton("ОЧИСТИТЬ АРХИВ") {
            AlertDialog.Builder(this)
                .setTitle("Удалить локальный архив?")
                .setMessage("Все сохранённые копии уведомлений будут удалены.")
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Удалить") { _, _ ->
                    NotificationArchive.clear(this)
                    refresh()
                }
                .show()
        })

        val label = TextView(this).apply {
            text = "ЛОКАЛЬНЫЙ АРХИВ"
            textSize = 16f
            setTextColor(0xFF00E68A.toInt())
            setPadding(0, 22, 0, 10)
        }
        root.addView(label)

        archiveView = TextView(this).apply {
            textSize = 14f
            setTextColor(0xFFE3EAF0.toInt())
            setPadding(12, 12, 12, 12)
            setBackgroundColor(0xFF101923.toInt())
        }
        root.addView(archiveView)

        val note = TextView(this).apply {
            text = "ОГРАНИЧЕНИЯ: одна галочка, read receipts, удаление сообщений у всех " +
                "и одноразовые медиа не контролируются этим прототипом."
            textSize = 12f
            setTextColor(0xFFFFC66D.toInt())
            setPadding(0, 18, 0, 8)
        }
        root.addView(note)
        setContentView(ScrollView(this).apply { addView(root) })
        refresh()
    }

    private fun actionButton(label: String, action: () -> Unit) =
        Button(this).apply {
            text = label
            setOnClickListener { action() }
        }

    private fun refresh() {
        val component = ComponentName(this, WhatsAppNotificationListener::class.java)
        val enabled = NotificationListenerService::class.java != null &&
            getSystemService(android.app.NotificationManager::class.java) != null &&
            Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
                ?.contains(component.flattenToString()) == true
        status.text = if (enabled) {
            "СТАТУС: АРХИВ УВЕДОМЛЕНИЙ ВКЛЮЧЁН"
        } else {
            "СТАТУС: НЕТ ДОСТУПА К УВЕДОМЛЕНИЯМ"
        }

        val records = NotificationArchive.readAll(this)
        archiveView.text = if (records.isEmpty()) {
            "Пока нет записей. Разрешите доступ и дождитесь нового уведомления WhatsApp."
        } else {
            records.joinToString("\n\n────────────────\n\n") { item ->
                val date = DateFormat.format("dd.MM.yyyy HH:mm:ss", Date(item.timestamp))
                val source = if (item.packageName == "com.whatsapp.w4b") "WhatsApp Business" else "WhatsApp"
                "$source · $date\n${item.title}\n${item.body}"
            }
        }
    }
}
