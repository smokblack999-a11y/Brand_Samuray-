package com.samurai.whatsapp

import android.app.AlertDialog
import android.content.ComponentName
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.format.DateFormat
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import androidx.biometric.BiometricManager
import androidx.fragment.app.FragmentActivity
import java.util.Date

/** Independent screens backed by SAMURAI's existing local feature stores. */
class ModuleCenterActivity : FragmentActivity() {
    private val module by lazy { intent.getStringExtra(EXTRA_MODULE) ?: "INBOX" }
    private val bg = Color.rgb(7, 12, 19)
    private val white = Color.rgb(235, 243, 249)
    private val muted = Color.rgb(145, 161, 178)
    private val mint = Color.rgb(0, 235, 157)
    private var pendingExportId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = bg
        window.navigationBarColor = bg
        applySecureFlag()
        if (AppLock.isEnabled(this)) {
            AppLock.authenticate(this, "SAMURAI", "Unlock local module",
                onSuccess = { render() },
                onError = { _, message ->
                    Toast.makeText(this, message, Toast.LENGTH_LONG).show()
                    finish()
                })
        } else render()
    }

    override fun onResume() {
        super.onResume()
        applySecureFlag()
    }

    @Deprecated("Uses Android document picker result callbacks")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != RESULT_OK) {
            pendingExportId = null
            return
        }
        val resultIntent = data ?: return
        val uri = resultIntent.data ?: return
        when (requestCode) {
            PICK_MEDIA -> background("Vault import failed") {
                MediaVault.importFromUri(applicationContext, uri)
            }
            EXPORT_MEDIA -> {
                val id = pendingExportId
                pendingExportId = null
                if (id != null) background("Vault export failed") {
                    MediaVault.exportToUri(applicationContext, id, uri)
                }
            }
            PICK_STATUS_TREE -> {
                runCatching { StatusSaver.setSelectedTree(this, uri, resultIntent.flags) }
                    .onSuccess { render() }.onFailure { fail(it) }
            }
            PICK_CHAT -> importChat(uri)
            VPN_CONSENT -> {
                if (resultCode == RESULT_OK) startNetworkBlock()
                else Toast.makeText(this, "VPN permission was not granted.", Toast.LENGTH_LONG).show()
                render()
            }
        }
    }

    private fun render() {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(20), dp(18), dp(28))
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Color.rgb(12, 30, 40), bg, Color.rgb(5, 9, 15))
            )
        }
        val scroll = ScrollView(this).apply { addView(page) }
        val heading = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        heading.addView(button("←  BACK") { finish() }, LinearLayout.LayoutParams(-2, dp(42)))
        heading.addView(text("SAMURAI / MODULE", 10f, mint, true).apply {
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(0, dp(42), 1f))
        page.addView(heading)
        page.addView(text(title(), 22f, white, true).apply {
            setPadding(0, dp(22), 0, dp(6))
        })
        page.addView(text("LIVE LOCAL DATA · DEVICE STORAGE", 9f, muted, true).apply {
            letterSpacing = 0.10f
            setPadding(0, 0, 0, dp(18))
        })
        when (module) {
            "INBOX" -> inbox(page)
            "VAULT" -> vault(page)
            "CHATS" -> chats(page)
            "TIMELINE" -> timeline(page)
            "STATUS" -> statuses(page)
            "SECURITY" -> security(page)
            else -> page.addView(text("Unknown module.", 14f, white, false))
        }
        page.addView(text(
            "SAMURAI LOCAL-FIRST · No cloud sync is claimed by this screen.",
            10f, muted, false
        ).apply { setPadding(0, dp(24), 0, 0) })
        setContentView(scroll)
    }

    private fun title(): String = when (module) {
        "INBOX" -> "MESSAGE INTELLIGENCE"
        "VAULT" -> "PRIVATE MEDIA VAULT"
        "CHATS" -> "CHAT IMPORT ARCHIVE"
        "TIMELINE" -> "EVIDENCE TIMELINE"
        "STATUS" -> "STATUS SAVER"
        "SECURITY" -> "SECURITY CENTER"
        else -> "MODULE NOT FOUND"
    }

    private fun inbox(page: LinearLayout) {
        val listener = ComponentName(this, WhatsAppNotificationListener::class.java)
        val access = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
            ?.split(':')?.contains(listener.flattenToString()) == true
        val enabled = NotificationArchive.isEnabled(this)
        info(page, "CAPTURE STATE",
            "Notification access: " + (if (access) "GRANTED" else "NOT GRANTED") +
                "\nArchive preference: " + (if (enabled) "ON" else "OFF") +
                "\nOnly new text exposed by Android notifications can be captured.")
        action(page, "OPEN NOTIFICATION ACCESS SETTINGS") {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
        page.addView(Switch(this).apply {
            text = "Archive new WhatsApp notifications"
            setTextColor(white)
            isChecked = enabled
            setOnCheckedChangeListener { _, checked ->
                NotificationArchive.setEnabled(this@ModuleCenterActivity, checked)
                render()
            }
        })
        val records = NotificationArchive.readAll(this)
        info(page, "ARCHIVED ITEMS", records.size.toString() + " / 200")
        if (records.isEmpty()) empty(page, "No captured notifications",
            "Enable access above, then wait for a new WhatsApp notification.")
        records.forEach { record ->
            val source = if (record.packageName == "com.whatsapp.w4b") "WhatsApp Business" else "WhatsApp"
            val stamp = DateFormat.format("dd MMM yyyy · HH:mm", Date(record.timestamp)).toString()
            card(page, source, stamp, record.title + "\n" + record.body) {
                AlertDialog.Builder(this).setTitle(record.title.ifBlank { source })
                    .setMessage(stamp + "\n\n" + record.body)
                    .setPositiveButton("CLOSE", null).show()
            }
        }
        action(page, "CLEAR NOTIFICATION ARCHIVE") {
            confirm("Clear archive?", "All locally archived notification records will be deleted.") {
                NotificationArchive.clear(this)
                render()
            }
        }
    }

    private fun vault(page: LinearLayout) {
        val items = MediaVault.list(this)
        info(page, "ENCRYPTED STORAGE",
            items.size.toString() + " / 100 files\n250 MiB per file · 1 GiB total")
        action(page, "＋  IMPORT MEDIA") {
            val picker = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "video/*", "audio/*"))
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivityForResult(picker, PICK_MEDIA)
        }
        if (items.isEmpty()) empty(page, "Vault is empty",
            "Choose an image, video or audio file through the Android document picker.")
        items.forEach { item ->
            val sub = item.mimeType + " · " + formatBytes(item.sizeBytes)
            card(page, item.displayName, sub, "AES-GCM encrypted · tap for export or delete") {
                AlertDialog.Builder(this).setTitle(item.displayName)
                    .setMessage(sub + "\n\nStored in app-private encrypted storage.")
                    .setNegativeButton("CLOSE", null)
                    .setNeutralButton("DELETE") { _, _ ->
                        runCatching { MediaVault.delete(this, item.id) }
                            .onSuccess { render() }.onFailure { fail(it) }
                    }
                    .setPositiveButton("EXPORT") { _, _ -> export(item) }
                    .show()
            }
        }
    }

    private fun chats(page: LinearLayout) {
        val items = WhatsAppExportArchive.list(this)
        info(page, "IMPORTED CONVERSATIONS",
            items.size.toString() + " / 100 archives · TXT / ZIP · AES-GCM at rest")
        action(page, "＋  IMPORT WHATSAPP TXT / ZIP") {
            val picker = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                putExtra(Intent.EXTRA_MIME_TYPES,
                    arrayOf("text/plain", "application/zip", "application/x-zip-compressed"))
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivityForResult(picker, PICK_CHAT)
        }
        if (items.isEmpty()) empty(page, "No imported conversations",
            "Use WhatsApp's own Export chat function, then import its TXT or ZIP output.")
        items.forEach { item ->
            val sub = item.messageCount.toString() + " messages · " +
                DateFormat.format("dd MMM yyyy", Date(item.importedAt))
            card(page, item.chatName, sub, item.sourceName + " · tap to view") {
                showChat(item)
            }
        }
        action(page, "DELETE ALL CHAT ARCHIVES") {
            confirm("Delete imported chats?", "This permanently removes the local encrypted chat archive.") {
                WhatsAppExportArchive.clear(this)
                render()
            }
        }
    }

    private fun timeline(page: LinearLayout) {
        val events = MessageTimeline.list(this)
        info(page, "SOURCE-VERIFIED EVENT LOG",
            events.size.toString() + " / 500 entries\nMissing events are not invented or inferred.")
        if (events.isEmpty()) empty(page, "No events recorded",
            "New notification captures and successful chat imports appear here.")
        events.forEach { event ->
            val eventTime = event.eventTime?.let {
                DateFormat.format("dd MMM yyyy HH:mm:ss", Date(it)).toString()
            } ?: "Source time not available"
            val observed = DateFormat.format("dd MMM yyyy HH:mm:ss", Date(event.observedAt)).toString()
            card(page, event.eventType, event.source,
                "Event: " + eventTime + "\nObserved: " + observed + "\n" + event.summary) {
                AlertDialog.Builder(this).setTitle(event.eventType)
                    .setMessage(event.source + "\n" + eventTime + "\n" + observed + "\n\n" + event.summary)
                    .setPositiveButton("CLOSE", null).show()
            }
        }
    }

    private fun statuses(page: LinearLayout) {
        val tree = StatusSaver.selectedTree(this)
        info(page, "USER-GRANTED FOLDER",
            if (tree == null) "Not connected. Select WhatsApp/Media or the .Statuses folder."
            else "A folder has been selected through Android's Storage Access Framework.")
        action(page, if (tree == null) "CONNECT STATUS FOLDER" else "CHANGE FOLDER") {
            startActivityForResult(StatusSaver.createPickerIntent(), PICK_STATUS_TREE)
        }
        if (tree != null) action(page, "DISCONNECT FOLDER") {
            confirm("Disconnect folder?", "The stored folder permission will be released.") {
                StatusSaver.clearSelectedTree(this)
                render()
            }
        }
        val result = runCatching { StatusSaver.list(this) }
        val files = result.getOrNull()
        if (files == null) empty(page, "Folder unavailable",
            result.exceptionOrNull()?.message ?: "Check the granted Android folder permission.")
        else if (files.isEmpty()) empty(page, "No accessible status files",
            "Only files still present in the selected folder can be saved.")
        else {
            info(page, "AVAILABLE MEDIA", files.size.toString() + " items")
            files.forEach { file ->
                card(page, file.displayName, file.mimeType,
                    formatBytes(file.sizeBytes) + " · tap to encrypt into Media Vault") {
                    Thread({
                        val saved = runCatching { StatusSaver.saveToVault(applicationContext, file) }
                        runOnUiThread {
                            saved.onSuccess {
                                Toast.makeText(this, "Saved to encrypted Media Vault", Toast.LENGTH_SHORT).show()
                                render()
                            }.onFailure { fail(it) }
                        }
                    }, "samurai-status-vault").start()
                }
            }
        }
    }

    private fun security(page: LinearLayout) {
        val locked = AppLock.isEnabled(this)
        val blocked = WhatsAppKillSwitchService.isEnabled(this)
        info(page, "APP LOCK",
            "Current state: " + (if (locked) "ENABLED" else "DISABLED") +
                "\nAndroid handles biometrics or device credentials. SAMURAI does not store your PIN.")
        action(page, if (locked) "AUTHENTICATE & DISABLE APP LOCK" else "ENABLE APP LOCK") {
            toggleLock()
        }
        info(page, "SCREENSHOT PROTECTION",
            if (locked) "FLAG_SECURE is active for this module and launcher."
            else "Enable App Lock to apply FLAG_SECURE to SAMURAI screens.")
        info(page, "WHATSAPP NETWORK BLOCK",
            "Current state: " + (if (blocked) "ACTIVE · packets discarded" else "OFF") +
                "\nLocal VPN scope: installed WhatsApp and WhatsApp Business packages.")
        action(page, if (blocked) "STOP NETWORK BLOCK" else "REQUEST NETWORK BLOCK") {
            if (blocked) stopNetworkBlock() else requestNetworkBlock()
        }
        action(page, "OPEN ANDROID APP PERMISSIONS") {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = android.net.Uri.parse("package:" + packageName)
            })
        }
        action(page, "OPEN LEGACY WORKSPACE") {
            startActivity(Intent(this, MainActivity::class.java))
        }
    }

    private fun toggleLock() {
        val enable = !AppLock.isEnabled(this)
        if (AppLock.canAuthenticate(this) != BiometricManager.BIOMETRIC_SUCCESS) {
            Toast.makeText(this, "Set up Android biometrics or device PIN first.", Toast.LENGTH_LONG).show()
            return
        }
        AppLock.authenticate(this, "SAMURAI Security",
            if (enable) "Confirm App Lock activation" else "Confirm App Lock deactivation",
            onSuccess = {
                runCatching { AppLock.setEnabled(this, enable) }
                    .onSuccess { applySecureFlag(); render() }.onFailure { fail(it) }
            },
            onError = { _, message -> Toast.makeText(this, message, Toast.LENGTH_LONG).show() })
    }

    private fun applySecureFlag() {
        if (AppLock.isEnabled(this)) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }

    private fun requestNetworkBlock() {
        val consent = VpnService.prepare(this)
        if (consent != null) startActivityForResult(consent, VPN_CONSENT)
        else startNetworkBlock()
    }

    private fun startNetworkBlock() {
        runCatching {
            val intent = Intent(this, WhatsAppKillSwitchService::class.java)
                .setAction(WhatsAppKillSwitchService.ACTION_START)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent)
            else startService(intent)
        }.onSuccess { Toast.makeText(this, "Network block requested", Toast.LENGTH_SHORT).show() }
            .onFailure { fail(it) }
        render()
    }

    private fun stopNetworkBlock() {
        runCatching {
            startService(Intent(this, WhatsAppKillSwitchService::class.java)
                .setAction(WhatsAppKillSwitchService.ACTION_STOP))
            WhatsAppKillSwitchService.markDisabled(this)
        }.onSuccess { render() }.onFailure { fail(it) }
    }

    private fun importChat(uri: android.net.Uri) {
        val name = queryName(uri)
        Thread({
            val parsed = runCatching {
                WhatsAppExportImporter.readAndParse(applicationContext, uri, name)
            }
            runOnUiThread {
                parsed.onSuccess { export ->
                    val preview = export.messages.take(5).joinToString("\n\n") {
                        (it.sender ?: "System") + ": " + it.text.take(220)
                    }
                    AlertDialog.Builder(this).setTitle("Confirm chat import")
                        .setMessage("Chat: " + export.chatName + "\nMessages: " +
                            export.messages.size + "\n\n" + preview +
                            "\n\nThe archive is encrypted on this device.")
                        .setNegativeButton("CANCEL", null)
                        .setPositiveButton("IMPORT") { _, _ ->
                            Thread({
                                val saved = runCatching {
                                    val item = WhatsAppExportArchive.save(applicationContext, export)
                                    MessageTimeline.recordChatExportImported(
                                        applicationContext, export.sourceHash, item.messageCount)
                                    item
                                }
                                runOnUiThread {
                                    saved.onSuccess {
                                        Toast.makeText(this, "Imported " + it.messageCount + " messages",
                                            Toast.LENGTH_LONG).show()
                                        render()
                                    }.onFailure { fail(it) }
                                }
                            }, "samurai-chat-store").start()
                        }.show()
                }.onFailure { fail(it) }
            }
        }, "samurai-chat-parse").start()
    }

    private fun showChat(chat: ImportedChatSummary) {
        Thread({
            val result = runCatching {
                WhatsAppExportArchive.readMessages(applicationContext, chat.id)
            }
            runOnUiThread {
                result.onSuccess { messages ->
                    val transcript = messages.take(30).joinToString("\n\n") { message ->
                        val whenText = message.timestamp?.let {
                            DateFormat.format("dd.MM.yyyy HH:mm:ss", Date(it)).toString()
                        } ?: "Time unavailable"
                        whenText + " · " + (message.sender ?: "System") + "\n" + message.text.take(900)
                    } + if (messages.size > 30) "\n\nShowing 30 of " + messages.size else ""
                    AlertDialog.Builder(this).setTitle(chat.chatName).setMessage(transcript)
                        .setPositiveButton("CLOSE", null)
                        .setNeutralButton("DELETE") { _, _ ->
                            confirm("Delete chat archive?", chat.chatName) {
                                WhatsAppExportArchive.delete(this, chat.id)
                                render()
                            }
                        }.show()
                }.onFailure { fail(it) }
            }
        }, "samurai-chat-view").start()
    }

    private fun export(item: MediaVaultItem) {
        pendingExportId = item.id
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = item.mimeType
            putExtra(Intent.EXTRA_TITLE, item.displayName.substringAfterLast('/'))
        }
        startActivityForResult(intent, EXPORT_MEDIA)
    }

    private fun background(errorLabel: String, task: () -> Any) {
        Thread({
            val result = runCatching { task() }
            runOnUiThread {
                result.onSuccess {
                    Toast.makeText(this, "Operation completed", Toast.LENGTH_SHORT).show()
                    render()
                }.onFailure { fail(it, errorLabel) }
            }
        }, "samurai-module-worker").start()
    }

    private fun queryName(uri: android.net.Uri): String {
        contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME),
            null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                if (index >= 0) cursor.getString(index)?.let { return it }
            }
        }
        return uri.lastPathSegment ?: "WhatsApp chat export"
    }

    private fun confirm(title: String, message: String, accepted: () -> Unit) {
        AlertDialog.Builder(this).setTitle(title).setMessage(message)
            .setNegativeButton("CANCEL", null)
            .setPositiveButton("CONFIRM") { _, _ -> accepted() }.show()
    }

    private fun fail(error: Throwable, prefix: String = "Operation failed") {
        Toast.makeText(this, prefix + ": " + (error.message ?: "unknown error"),
            Toast.LENGTH_LONG).show()
    }

    private fun info(page: LinearLayout, title: String, body: String) {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(15), dp(15), dp(15), dp(15))
            background = rounded(Color.rgb(17, 43, 53), dp(14))
        }
        box.addView(text(title, 10f, mint, true))
        box.addView(text(body, 13f, white, false).apply { setPadding(0, dp(8), 0, 0) })
        page.addView(box, params(-1, -2, dp(12)))
    }

    private fun empty(page: LinearLayout, title: String, body: String) {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(18), dp(24), dp(18), dp(24))
            background = rounded(Color.rgb(15, 26, 38), dp(14))
        }
        box.addView(text(title, 15f, white, true).apply { gravity = Gravity.CENTER })
        box.addView(text(body, 12f, muted, false).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, 0)
        })
        page.addView(box, params(-1, -2, dp(10)))
    }

    private fun card(page: LinearLayout, title: String, subtitle: String, detail: String, click: () -> Unit) {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(13), dp(14), dp(13))
            background = rounded(Color.rgb(17, 29, 42), dp(13))
            isClickable = true
            isFocusable = true
            setOnClickListener { click() }
        }
        box.addView(text(title, 13f, white, true))
        box.addView(text(subtitle, 10f, mint, true).apply { setPadding(0, dp(4), 0, 0) })
        box.addView(text(detail, 11f, muted, false).apply { setPadding(0, dp(7), 0, 0) })
        page.addView(box, params(-1, -2, dp(8)))
    }

    private fun action(page: LinearLayout, title: String, click: () -> Unit) {
        page.addView(button(title, click), params(-1, dp(46), dp(7)))
    }

    private fun button(title: String, click: () -> Unit) = Button(this).apply {
        text = title
        isAllCaps = false
        textSize = 10f
        setTextColor(white)
        background = rounded(Color.rgb(22, 39, 53), dp(10))
        setOnClickListener { click() }
    }

    private fun text(value: String, size: Float, color: Int, bold: Boolean) =
        TextView(this).apply {
            text = value
            textSize = size
            setTextColor(color)
            typeface = if (bold) android.graphics.Typeface.DEFAULT_BOLD else android.graphics.Typeface.DEFAULT
        }

    private fun rounded(color: Int, radius: Int) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = radius.toFloat()
    }

    private fun params(width: Int, height: Int, bottom: Int) =
        LinearLayout.LayoutParams(width, height).apply { bottomMargin = bottom }

    private fun formatBytes(size: Long): String = when {
        size >= 1024L * 1024L -> String.format("%.1f MiB", size / (1024.0 * 1024.0))
        size >= 1024L -> String.format("%.1f KiB", size / 1024.0)
        else -> size.toString() + " B"
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_MODULE = "samurai.module"
        private const val PICK_MEDIA = 8101
        private const val EXPORT_MEDIA = 8102
        private const val PICK_STATUS_TREE = 8103
        private const val PICK_CHAT = 8104
        private const val VPN_CONSENT = 8105
    }
}
