package com.samurai.whatsapp

import android.app.AlertDialog
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import android.provider.OpenableColumns
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
import androidx.fragment.app.FragmentActivity

class MainActivity : FragmentActivity() {
    private lateinit var status: TextView
    private lateinit var archiveView: TextView
    private lateinit var vaultContainer: LinearLayout
    private lateinit var importedChatContainer: LinearLayout
    private lateinit var statusContainer: LinearLayout
    private lateinit var timelineContainer: LinearLayout
    private var pendingExportId: String? = null
    private var contentRendered = false
    private var authInProgress = false
    private var backgroundedAt = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (AppLock.isEnabled(this)) {
            authenticateAndRender()
        } else {
            render()
        }
    }

    override fun onResume() {
        super.onResume()
        if (contentRendered && AppLock.isEnabled(this) &&
            backgroundedAt > 0L &&
            SystemClock.elapsedRealtime() - backgroundedAt >= APP_LOCK_TIMEOUT_MS
        ) {
            backgroundedAt = 0L
            authenticateAndRender()
            return
        }
        if (::status.isInitialized) refresh()
        if (::statusContainer.isInitialized) refreshStatusSaver()
    }

    override fun onStop() {
        if (contentRendered && !isFinishing && !isChangingConfigurations) {
            backgroundedAt = SystemClock.elapsedRealtime()
        }
        super.onStop()
    }

    private fun authenticateAndRender() {
        if (authInProgress) return
        authInProgress = true
        val lockScreen = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(32, 32, 32, 32)
            setBackgroundColor(0xFF080D13.toInt())
        }
        lockScreen.addView(TextView(this).apply {
            text = "SAMURAI LOCK"
            textSize = 24f
            setTextColor(0xFF00E68A.toInt())
            gravity = Gravity.CENTER
        })
        lockScreen.addView(TextView(this).apply {
            text = "Подтверди личность биометрией или PIN-кодом устройства."
            textSize = 14f
            setTextColor(0xFFE3EAF0.toInt())
            gravity = Gravity.CENTER
            setPadding(0, 16, 0, 20)
        })
        val retry = actionButton("РАЗБЛОКИРОВАТЬ") { authenticateAndRender() }
        lockScreen.addView(retry)
        setContentView(lockScreen)

        AppLock.authenticate(
            this,
            "SAMURAI WhatsApp",
            "Разблокируй локальное хранилище",
            onSuccess = {
                authInProgress = false
                backgroundedAt = 0L
                render()
            },
            onError = { _, message ->
                authInProgress = false
                Toast.makeText(this, message, Toast.LENGTH_LONG).show()
                retry.isEnabled = true
            }
        )
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
            REQUEST_IMPORT_MEDIA -> {
                Thread({
                    val result = runCatching {
                        MediaVault.importFromUri(applicationContext, uri)
                    }
                    runOnUiThread {
                        result.onSuccess { item ->
                            Toast.makeText(
                                this,
                                "Добавлено в Media Vault: ${item.displayName}",
                                Toast.LENGTH_SHORT
                            ).show()
                        }.onFailure { error ->
                            Toast.makeText(
                                this,
                                error.message ?: "Не удалось импортировать файл",
                                Toast.LENGTH_LONG
                            ).show()
                        }
                        refresh()
                    }
                }, "samurai-media-import").start()
            }

            REQUEST_EXPORT_MEDIA -> {
                val itemId = pendingExportId
                pendingExportId = null
                if (itemId != null) {
                    Thread({
                        val result = runCatching {
                            MediaVault.exportToUri(applicationContext, itemId, uri)
                        }
                        runOnUiThread {
                            result.onSuccess {
                                Toast.makeText(this, "Файл экспортирован", Toast.LENGTH_SHORT).show()
                            }.onFailure { error ->
                                Toast.makeText(
                                    this,
                                    error.message ?: "Не удалось экспортировать файл",
                                    Toast.LENGTH_LONG
                                ).show()
                            }
                            refresh()
                        }
                    }, "samurai-media-export").start()
                }
            }

            REQUEST_SELECT_STATUS_FOLDER -> {
                val flags = data?.flags ?: 0
                runCatching {
                    StatusSaver.setSelectedTree(this, uri, flags)
                }.onSuccess {
                    Toast.makeText(this, "Папка статусов подключена", Toast.LENGTH_SHORT).show()
                    refreshStatusSaver()
                }.onFailure { error ->
                    Toast.makeText(this, error.message ?: "Не удалось открыть папку", Toast.LENGTH_LONG).show()
                }
            }

            REQUEST_IMPORT_CHAT -> {
                val sourceName = queryDisplayName(uri)
                Thread({
                    val result = runCatching {
                        WhatsAppExportImporter.readAndParse(applicationContext, uri, sourceName)
                    }
                    runOnUiThread {
                        result.onSuccess { parsed ->
                            val sample = parsed.messages.take(5).joinToString("\n\n") { message ->
                                val sender = message.sender ?: "Системное событие"
                                "$sender: ${message.text.take(220)}"
                            }
                            AlertDialog.Builder(this)
                                .setTitle("Предварительный просмотр экспорта")
                                .setMessage(
                                    "Чат: ${parsed.chatName}\n" +
                                        "Сообщений найдено: ${parsed.messages.size}\n" +
                                        "Файл: ${parsed.sourceName}\n\n" +
                                        "Первые сообщения:\n$sample\n\n" +
                                        "История будет сохранена в зашифрованном локальном архиве."
                                )
                                .setNegativeButton("Отмена", null)
                                .setPositiveButton("Импортировать") { _, _ ->
                                    Thread({
                                        val saved = runCatching {
                                            WhatsAppExportArchive.save(applicationContext, parsed)
                                        }
                                        runOnUiThread {
                                            saved.onSuccess { item ->
                                                runCatching {
                                                    MessageTimeline.recordChatExportImported(
                                                        applicationContext,
                                                        parsed.sourceHash,
                                                        item.messageCount
                                                    )
                                                }
                                                Toast.makeText(
                                                    this,
                                                    "Импортировано: ${item.messageCount} сообщений",
                                                    Toast.LENGTH_LONG
                                                ).show()
                                                refresh()
                                            }.onFailure { error ->
                                                Toast.makeText(
                                                    this,
                                                    error.message ?: "Не удалось сохранить экспорт",
                                                    Toast.LENGTH_LONG
                                                ).show()
                                            }
                                        }
                                    }, "samurai-chat-export-save").start()
                                }
                                .show()
                        }.onFailure { error ->
                            Toast.makeText(
                                this,
                                error.message ?: "Не удалось прочитать экспорт чата",
                                Toast.LENGTH_LONG
                            ).show()
                        }
                    }
                }, "samurai-chat-export-parse").start()
            }
        }
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
            text = "Выбирай фото, видео и аудио через системный выбор Android. Файлы шифруются и хранятся локально. Лимит одного файла — 250 МиБ, общий лимит — 1 ГиБ, максимум — 100 файлов. View Once не обходится."
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

        root.addView(sectionLabel("ИМПОРТ ИСТОРИИ WHATSAPP"))
        val exportNote = TextView(this).apply {
            text = "Импортируй собственный экспорт чата из WhatsApp (.txt или .zip). SAMURAI не читает закрытую базу WhatsApp. История сохраняется отдельно и шифруется на устройстве."
            textSize = 12f
            setTextColor(0xFF9AA8B5.toInt())
            setPadding(0, 0, 0, 10)
        }
        root.addView(exportNote)
        root.addView(actionButton("ИМПОРТИРОВАТЬ ЭКСПОРТ ЧАТА") {
            openChatExportPicker()
        })
        root.addView(actionButton("ОЧИСТИТЬ ИМПОРТИРОВАННЫЕ ЧАТЫ") {
            AlertDialog.Builder(this)
                .setTitle("Удалить импортированные чаты?")
                .setMessage("Будут удалены все импортированные экспорты и их ключ шифрования.")
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Удалить") { _, _ ->
                    WhatsAppExportArchive.clear(this)
                    refresh()
                    Toast.makeText(this, "Импортированные чаты удалены", Toast.LENGTH_SHORT).show()
                }
                .show()
        })
        importedChatContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(12, 12, 12, 12)
            setBackgroundColor(0xFF101923.toInt())
        }
        root.addView(importedChatContainer)

        root.addView(sectionLabel("STATUS SAVER · ЛОКАЛЬНЫЕ СТАТУСЫ"))
        val statusNote = TextView(this).apply {
            text = "Подключи папку WhatsApp/Media через системный выбор Android. SAMURAI покажет только доступные на устройстве фото и видео статусов; сохранение копирует выбранный файл в зашифрованный Media Vault."
            textSize = 12f
            setTextColor(0xFF9AA8B5.toInt())
            setPadding(0, 0, 0, 10)
        }
        root.addView(statusNote)
        root.addView(actionButton("ВЫБРАТЬ ПАПКУ WHATSAPP / MEDIA") {
            openStatusFolderPicker()
        })
        root.addView(actionButton("ОБНОВИТЬ СПИСОК СТАТУСОВ") {
            refreshStatusSaver()
        })
        root.addView(actionButton("ОТКЛЮЧИТЬ ДОСТУП К ПАПКЕ") {
            StatusSaver.clearSelectedTree(this)
            refreshStatusSaver()
        })
        statusContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(12, 12, 12, 12)
            setBackgroundColor(0xFF101923.toInt())
        }
        root.addView(statusContainer)

        root.addView(sectionLabel("MESSAGE TIMELINE · ЖУРНАЛ ДОКАЗАТЕЛЬНЫХ СОБЫТИЙ"))
        val timelineNote = TextView(this).apply {
            text = "Показываются только события, которые SAMURAI реально наблюдал: уведомления и импорт истории. Отсутствие отметки о прочтении не означает, что сообщение не прочитано."
            textSize = 12f
            setTextColor(0xFF9AA8B5.toInt())
            setPadding(0, 0, 0, 10)
        }
        root.addView(timelineNote)
        root.addView(actionButton("ОЧИСТИТЬ ЖУРНАЛ СОБЫТИЙ") {
            AlertDialog.Builder(this)
                .setTitle("Удалить журнал событий?")
                .setMessage("Будут удалены зашифрованные события и ключ журнала.")
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Удалить") { _, _ ->
                    MessageTimeline.clear(this)
                    refresh()
                }
                .show()
        })
        timelineContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(12, 12, 12, 12)
            setBackgroundColor(0xFF101923.toInt())
        }
        root.addView(timelineContainer)

        root.addView(sectionLabel("APP LOCK · ЗАЩИТА ПРИЛОЖЕНИЯ"))
        root.addView(actionButton(
            if (AppLock.isEnabled(this)) "ОТКЛЮЧИТЬ APP LOCK" else "ВКЛЮЧИТЬ БИОМЕТРИЮ / PIN"
        ) {
            val enableAfterAuth = !AppLock.isEnabled(this)
            AppLock.authenticate(
                this,
                "SAMURAI App Lock",
                "Подтверди изменение защиты",
                onSuccess = {
                    runCatching { AppLock.setEnabled(this, enableAfterAuth) }
                        .onSuccess {
                            Toast.makeText(
                                this,
                                if (enableAfterAuth) "App Lock включён" else "App Lock отключён",
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                        .onFailure { error ->
                            Toast.makeText(this, error.message ?: "Не удалось сохранить настройку", Toast.LENGTH_LONG).show()
                        }
                    refreshSecurityLabel()
                },
                onError = { _, message ->
                    Toast.makeText(this, message, Toast.LENGTH_LONG).show()
                }
            )
        })
        val appLockNote = TextView(this).apply {
            text = if (AppLock.isEnabled(this@MainActivity)) {
                "Защита активна: при запуске и после 30 секунд в фоне потребуется системная биометрия или PIN/пароль устройства."
            } else {
                "Защита выключена. Включение потребует настроенный системный PIN/пароль или биометрию."
            }
            textSize = 12f
            setTextColor(0xFF9AA8B5.toInt())
            setPadding(0, 0, 0, 12)
            tag = APP_LOCK_NOTE_TAG
        }
        root.addView(appLockNote)

        val note = TextView(this).apply {
            text = "ОГРАНИЧЕНИЯ: One Tick, read receipts, скрытые статусы и удаление сообщений у всех не контролируются этим прототипом. Для One Tick нужна отдельная лабораторная проверка на тестовом аккаунте."
            textSize = 12f
            setTextColor(0xFFFFC66D.toInt())
            setPadding(0, 18, 0, 8)
        }
        root.addView(note)

        setContentView(ScrollView(this).apply { addView(root) })
        contentRendered = true
        refresh()
        refreshStatusSaver()
    }

    private fun openStatusFolderPicker() {
        startActivityForResult(StatusSaver.createPickerIntent(), REQUEST_SELECT_STATUS_FOLDER)
    }

    private fun refreshStatusSaver() {
        if (!::statusContainer.isInitialized) return
        val selected = StatusSaver.selectedTree(this)
        if (selected == null) {
            renderStatusItems(emptyList(), "Папка ещё не выбрана. Нажми «Выбрать папку WhatsApp / Media».")
            return
        }
        renderStatusItems(emptyList(), "Читаю доступную папку статусов…")
        Thread({
            val result = runCatching { StatusSaver.list(applicationContext) }
            runOnUiThread {
                result.onSuccess { items ->
                    renderStatusItems(
                        items,
                        if (items.isEmpty()) "Доступная папка подключена, но видимые файлы статусов не найдены."
                        else null
                    )
                }.onFailure { error ->
                    renderStatusItems(emptyList(), error.message ?: "Папка статусов недоступна")
                }
            }
        }, "samurai-status-refresh").start()
    }

    private fun renderStatusItems(items: List<CachedStatusFile>, emptyMessage: String?) {
        if (!::statusContainer.isInitialized) return
        statusContainer.removeAllViews()
        statusContainer.addView(TextView(this).apply {
            text = "Найдено файлов: ${items.size} / 300"
            textSize = 13f
            setTextColor(0xFF00E68A.toInt())
            setPadding(0, 0, 0, 8)
        })
        if (items.isEmpty()) {
            statusContainer.addView(TextView(this).apply {
                text = emptyMessage ?: "Статусов не найдено."
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
                val time = if (item.modifiedAt > 0) {
                    DateFormat.format("dd.MM.yyyy HH:mm", Date(item.modifiedAt)).toString()
                } else "время неизвестно"
                text = "${item.displayName}\n${item.mimeType} · ${formatBytes(item.sizeBytes)} · $time"
                textSize = 13f
                setTextColor(0xFFE3EAF0.toInt())
            })
            entry.addView(actionButton("СОХРАНИТЬ В ЗАШИФРОВАННЫЙ VAULT") {
                Thread({
                    val result = runCatching {
                        StatusSaver.saveToVault(applicationContext, item)
                    }
                    runOnUiThread {
                        result.onSuccess { saved ->
                            Toast.makeText(
                                this,
                                "Сохранено в Media Vault: ${saved.displayName}",
                                Toast.LENGTH_SHORT
                            ).show()
                            refresh()
                        }.onFailure { error ->
                            Toast.makeText(
                                this,
                                error.message ?: "Не удалось сохранить статус",
                                Toast.LENGTH_LONG
                            ).show()
                        }
                    }
                }, "samurai-status-save").start()
            })
            statusContainer.addView(entry)
        }
    }

    private fun refreshSecurityLabel() {
        val root = (findViewById<android.view.ViewGroup>(android.R.id.content))
        // Refresh the status note without rebuilding the full archive screen.
        val note = findViewByTag(root, APP_LOCK_NOTE_TAG) as? TextView ?: return
        note.text = if (AppLock.isEnabled(this)) {
            "Защита активна: при запуске и после 30 секунд в фоне потребуется системная биометрия или PIN/пароль устройства."
        } else {
            "Защита выключена. Включение потребует настроенный системный PIN/пароль или биометрию."
        }
    }

    private fun findViewByTag(parent: android.view.View?, targetTag: String): android.view.View? {
        if (parent == null) return null
        if (parent.tag == targetTag) return parent
        if (parent is android.view.ViewGroup) {
            for (index in 0 until parent.childCount) {
                findViewByTag(parent.getChildAt(index), targetTag)?.let { return it }
            }
        }
        return null
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

    private fun openChatExportPicker() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(
                Intent.EXTRA_MIME_TYPES,
                arrayOf("text/plain", "application/zip", "application/x-zip-compressed")
            )
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivityForResult(intent, REQUEST_IMPORT_CHAT)
    }

    private fun queryDisplayName(uri: Uri): String {
        contentResolver.query(
            uri,
            arrayOf(OpenableColumns.DISPLAY_NAME),
            null,
            null,
            null
        )?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) cursor.getString(index)?.let { return it }
            }
        }
        return uri.lastPathSegment ?: "WhatsApp chat export"
    }

    private fun renderImportedChats() {
        importedChatContainer.removeAllViews()
        val chats = runCatching { WhatsAppExportArchive.list(this) }.getOrDefault(emptyList())
        importedChatContainer.addView(TextView(this).apply {
            text = "Импортировано чатов: ${chats.size} / 100"
            textSize = 13f
            setTextColor(0xFF00E68A.toInt())
            setPadding(0, 0, 0, 8)
        })
        if (chats.isEmpty()) {
            importedChatContainer.addView(TextView(this).apply {
                text = "Пока нет импортированных чатов."
                textSize = 13f
                setTextColor(0xFFE3EAF0.toInt())
            })
            return
        }
        chats.forEach { chat ->
            val entry = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(0, 10, 0, 10)
            }
            entry.addView(TextView(this).apply {
                text = "${chat.chatName}\n${chat.messageCount} сообщений · ${chat.sourceName}"
                textSize = 13f
                setTextColor(0xFFE3EAF0.toInt())
            })
            val actions = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(actionButton("ПРОСМОТР") { showImportedChat(chat) },
                    LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                addView(actionButton("УДАЛИТЬ") {
                    AlertDialog.Builder(this@MainActivity)
                        .setTitle("Удалить импортированный чат?")
                        .setMessage(chat.chatName)
                        .setNegativeButton("Отмена", null)
                        .setPositiveButton("Удалить") { _, _ ->
                            WhatsAppExportArchive.delete(this@MainActivity, chat.id)
                            refresh()
                        }
                        .show()
                }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            }
            entry.addView(actions)
            importedChatContainer.addView(entry)
        }
    }

    private fun showImportedChat(chat: ImportedChatSummary) {
        Thread({
            val result = runCatching {
                WhatsAppExportArchive.readMessages(applicationContext, chat.id)
            }
            runOnUiThread {
                result.onSuccess { messages ->
                    val transcript = messages.take(20).joinToString("\n\n") { message ->
                        val time = message.timestamp?.let {
                            DateFormat.format("dd.MM.yyyy HH:mm:ss", Date(it)).toString()
                        } ?: "Время не распознано"
                        val sender = message.sender ?: "Системное событие"
                        "$time · $sender\n${message.text.take(1200)}"
                    }
                    val suffix = if (messages.size > 80) {
                        "\n\nПоказаны первые 20 из ${messages.size} сообщений."
                    } else ""
                    AlertDialog.Builder(this)
                        .setTitle(chat.chatName)
                        .setMessage(transcript + suffix)
                        .setPositiveButton("Закрыть", null)
                        .show()
                }.onFailure { error ->
                    Toast.makeText(
                        this,
                        error.message ?: "Не удалось открыть архив",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }, "samurai-chat-export-view").start()
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
        if (::importedChatContainer.isInitialized) renderImportedChats()
        if (::timelineContainer.isInitialized) renderTimeline()
    }

    private fun renderTimeline() {
        timelineContainer.removeAllViews()
        val events = MessageTimeline.list(this)
        timelineContainer.addView(TextView(this).apply {
            text = "Событий: ${events.size} / 500"
            textSize = 13f
            setTextColor(0xFF00E68A.toInt())
            setPadding(0, 0, 0, 8)
        })
        if (events.isEmpty()) {
            timelineContainer.addView(TextView(this).apply {
                text = "Пока нет подтверждённых событий."
                textSize = 13f
                setTextColor(0xFFE3EAF0.toInt())
            })
            return
        }
        events.take(60).forEach { event ->
            val sourceTime = event.eventTime?.let {
                DateFormat.format("dd.MM.yyyy HH:mm:ss", Date(it)).toString()
            } ?: "время источника не предоставлено"
            val observedTime = DateFormat.format(
                "dd.MM.yyyy HH:mm:ss",
                Date(event.observedAt)
            )
            timelineContainer.addView(TextView(this).apply {
                text = "${event.eventType}\nИсточник: ${event.source}\nСобытие: $sourceTime\nНаблюдение SAMURAI: $observedTime\n${event.summary}"
                textSize = 12f
                setTextColor(0xFFE3EAF0.toInt())
                setPadding(0, 8, 0, 14)
            })
        }
    }

    companion object {
        private const val REQUEST_IMPORT_MEDIA = 4101
        private const val REQUEST_EXPORT_MEDIA = 4102
        private const val REQUEST_IMPORT_CHAT = 4103
        private const val REQUEST_SELECT_STATUS_FOLDER = 4104
        private const val APP_LOCK_TIMEOUT_MS = 30_000L
        private const val APP_LOCK_NOTE_TAG = "samurai_app_lock_note"
    }
}
