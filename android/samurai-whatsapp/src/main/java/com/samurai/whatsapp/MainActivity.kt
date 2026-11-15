package com.samurai.whatsapp

import android.app.Activity
import android.app.AlertDialog
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.text.format.DateFormat
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import java.util.Date

class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var archiveView: TextView
    private lateinit var vaultContainer: LinearLayout
    private var pendingExportId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        render()
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) refresh()
    }

    @Deprecated("Uses the platform document picker result callback for broad Android compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != RESULT_OK) {
            pendingExportId = null
            return
        }

        val uri = data?.data ?: run {
            pendingExportId = null
            return
        }

        when (requestCode) {
            REQUEST_IMPORT_MEDIA -> runCatching {
                MediaVault.importFromUri(this, uri)
            }.onSuccess { item ->
                Toast.makeText(this, "Добавлено в Media Vault: ${item.displayName}", Toast.LENGTH_SHORT).show()
                refresh()
            }.onFailure { error ->
                Toast.makeText(this, error.message ?: "Не удалось импортировать файл", Toast.LENGTH_LONG).show()
            }

            REQUEST_EXPORT_MEDIA -> {
                val itemId = pendingExportId
                pendingExportId = null
                if (itemId != null) {
                    runCatching {
                        MediaVault.exportToUri(this, itemId, uri)
                    }.onSuccess {
                        Toast.makeText(this, "Файл экспортирован", Toast.LENGTH_SHORT).show()
                    }.onFailure { error ->
                        Toast.makeText(this, error.message ?: "Не удалось экспортировать файл", Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
        refresh()
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

        val archiveSwitch = Switch(this).apply {
            text = "Сохранять новые уведомления"
            textSize = 14f
            setTextColor(0xFFFFFFFF.toInt())
            isChecked = NotificationArchive.isEnabled(this@MainActivity)
            setOnCheckedChangeListener { _, enabled ->
                NotificationArchive.setEnabled(this@MainActivity, enabled)
                refresh()
            }
            setPadding(4, 12, 4, 12)
        }
        root.addView(archiveSwitch)

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

        val archiveLabel = sectionLabel("ЛОКАЛЬНЫЙ АРХИВ")
        root.addView(archiveLabel)

        archiveView = TextView(this).apply {
            textSize = 14f
            setTextColor(0xFFE3EAF0.toInt())
            setPadding(12, 12, 12, 12)
            setBackgroundColor(0xFF101923.toInt())
        }
        root.addView(archiveView)

        root.addView(sectionLabel("ЗАЩИЩЁННОЕ МЕДИА-ХРАНИЛИЩЕ"))

        val vaultNote = TextView(this).apply {
            text = "Выбирай фото, видео и аудио через системный выбор Android. Файлы шифруются и хранятся локально. Лимит одного файла — 250 МиБ, максимум — 100 файлов. View Once не обходится."
            textSize = 12f
            setTextColor(0xFF9AA8B5.toInt())
            setPadding(0, 0, 0, 10)
        }
        root.addView(vaultNote)

        root.addView(actionButton("ИМПОРТИРОВАТЬ ФОТО / ВИДЕО / АУДИО") {
            openMediaPicker()
        })
        root.addView(actionButton("ОЧИСТИТЬ MEDIA VAULT") {
            AlertDialog.Builder(this)
                .setTitle("Очистить Media Vault?")
                .setMessage("Будут удалены все файлы и зашифрованный индекс этого локального хранилища.")
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Очистить") { _, _ ->
                    MediaVault.clear(this)
                    refresh()
                    Toast.makeText(this, "Media Vault очищен", Toast.LENGTH_SHORT).show()
                }
                .show()
        })

        vaultContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(12, 12, 12, 12)
            setBackgroundColor(0xFF101923.toInt())
        }
        root.addView(vaultContainer)

        val note = TextView(this).apply {
            text = "ОГРАНИЧЕНИЯ: One Tick, read receipts, скрытые статусы и удаление сообщений у всех не контролируются этим прототипом. Для One Tick нужна отдельная лабораторная проверка на тестовом аккаунте."
            textSize = 12f
            setTextColor(0xFFFFC66D.toInt())
            setPadding(0, 18, 0, 8)
        }
        root.addView(note)

        setContentView(ScrollView(this).apply { addView(root) })
        refresh()
    }

    private fun openMediaPicker() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "video/*", "audio/*"))
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivityForResult(intent, REQUEST_IMPORT_MEDIA)
    }

    private fun startExport(item: MediaVaultItem) {
        pendingExportId = item.id
        val safeName = item.displayName.substringAfterLast('/').substringAfterLast('\\')
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = item.mimeType
            putExtra(Intent.EXTRA_TITLE, safeName.ifBlank { "samurai-media" })
        }
        startActivityForResult(intent, REQUEST_EXPORT_MEDIA)
    }

    private fun renderVault() {
        vaultContainer.removeAllViews()
        val items = runCatching { MediaVault.list(this) }.getOrDefault(emptyList())
        val summary = TextView(this).apply {
            text = "Файлов: ${items.size} / 100"
            textSize = 13f
            setTextColor(0xFF00E68A.toInt())
            setPadding(0, 0, 0, 8)
        }
        vaultContainer.addView(summary)

        if (items.isEmpty()) {
            vaultContainer.addView(TextView(this).apply {
                text = "Хранилище пусто. Импортируй файл через системный выбор Android."
                textSize = 13f
                setTextColor(0xFFE3EAF0.toInt())
            })
            return
        }

        items.forEach { item ->
            val entry = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(0, 10, 0, 10)
            }
            entry.addView(TextView(this).apply {
                text = "${item.displayName}\n${item.mimeType} · ${formatBytes(item.sizeBytes)} · ${DateFormat.format("dd.MM.yyyy HH:mm", Date(item.importedAt))}"
                textSize = 13f
                setTextColor(0xFFE3EAF0.toInt())
            })
            val actions = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(actionButton("ЭКСПОРТ") { startExport(item) }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                addView(actionButton("УДАЛИТЬ") {
                    AlertDialog.Builder(this@MainActivity)
                        .setTitle("Удалить файл из Media Vault?")
                        .setMessage(item.displayName)
                        .setNegativeButton("Отмена", null)
                        .setPositiveButton("Удалить") { _, _ ->
                            runCatching { MediaVault.delete(this@MainActivity, item.id) }
                                .onSuccess { refresh() }
                                .onFailure { error ->
                                    Toast.makeText(this@MainActivity, error.message ?: "Не удалось удалить файл", Toast.LENGTH_LONG).show()
                                }
                        }
                        .show()
                }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            }
            entry.addView(actions)
            vaultContainer.addView(entry)
        }
    }

    private fun formatBytes(bytes: Long): String = when {
        bytes >= 1024L * 1024L -> String.format("%.1f MiB", bytes / (1024.0 * 1024.0))
        bytes >= 1024L -> String.format("%.1f KiB", bytes / 1024.0)
        else -> "$bytes B"
    }

    private fun sectionLabel(value: String) = TextView(this).apply {
        text = value
        textSize = 16f
        setTextColor(0xFF00E68A.toInt())
        setPadding(0, 22, 0, 10)
    }

    private fun actionButton(label: String, action: () -> Unit) =
        Button(this).apply {
            text = label
            setOnClickListener { action() }
        }

    private fun refresh() {
        val component = ComponentName(this, WhatsAppNotificationListener::class.java)
        val accessGranted = Settings.Secure.getString(
            contentResolver,
            "enabled_notification_listeners"
        )?.split(':')?.contains(component.flattenToString()) == true
        val archiveEnabled = NotificationArchive.isEnabled(this)
        status.text = when {
            !accessGranted -> "СТАТУС: НУЖНО РАЗРЕШИТЬ ДОСТУП К УВЕДОМЛЕНИЯМ"
            !archiveEnabled -> "СТАТУС: АРХИВ ПРИОСТАНОВЛЕН"
            else -> "СТАТУС: ЛОКАЛЬНЫЙ АРХИВ АКТИВЕН"
        }

        val records = NotificationArchive.readAll(this)
        archiveView.text = "Записей: ${records.size} / 200\n\n" + if (records.isEmpty()) {
            "Пока нет записей. Разрешите доступ и дождитесь нового уведомления WhatsApp."
        } else {
            records.joinToString("\n\n────────────────\n\n") { item ->
                val date = DateFormat.format("dd.MM.yyyy HH:mm:ss", Date(item.timestamp))
                val source = if (item.packageName == "com.whatsapp.w4b") "WhatsApp Business" else "WhatsApp"
                "$source · $date\n${item.title}\n${item.body}"
            }
        }
        if (::vaultContainer.isInitialized) renderVault()
    }

    companion object {
        private const val REQUEST_IMPORT_MEDIA = 4101
        private const val REQUEST_EXPORT_MEDIA = 4102
    }
}
