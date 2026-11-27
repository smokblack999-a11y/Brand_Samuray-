package com.samurai.whatsapp

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Independent SAMURAI command launcher.
 *
 * This shell deliberately delegates existing feature workflows to MainActivity
 * until each feature receives a stable, independently navigable screen.
 * Status labels are derived from local app state; no mock health claims.
 */
class LauncherActivity : Activity() {
    private lateinit var root: LinearLayout
    private lateinit var summary: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        render()
    }

    override fun onResume() {
        super.onResume()
        if (::summary.isInitialized) refreshSummary()
    }

    private fun render() {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(24), dp(20), dp(20))
            setBackgroundColor(0xFF080D13.toInt())
        }
        val scroll = ScrollView(this).apply { addView(page) }

        page.addView(TextView(this).apply {
            text = "SAMURAI"
            textSize = 30f
            letterSpacing = 0.12f
            setTextColor(0xFF00E68A.toInt())
            gravity = Gravity.CENTER_VERTICAL
        })
        page.addView(TextView(this).apply {
            text = "COMMAND CENTER  /  HYBRID V1"
            textSize = 11f
            letterSpacing = 0.10f
            setTextColor(0xFF91A0AE.toInt())
            setPadding(0, dp(4), 0, dp(18))
        })

        summary = TextView(this).apply {
            textSize = 14f
            setTextColor(0xFFE3EAF0.toInt())
            setPadding(dp(14), dp(14), dp(14), dp(14))
            setBackgroundColor(0xFF14212B.toInt())
        }
        page.addView(summary)
        refreshSummary()

        page.addView(section("MODULES"))
        moduleCard(page, "MESSAGE INTELLIGENCE", "Notification archive and evidence-based timeline") {
            openWorkspace()
        }
        moduleCard(page, "MEDIA VAULT", "Encrypted local media and user-selected imports") {
            openWorkspace()
        }
        moduleCard(page, "STATUS SAVER", "Browse cached status media through granted folder access") {
            openWorkspace()
        }
        moduleCard(page, "CHAT IMPORT", "Import and inspect your own WhatsApp TXT / ZIP exports") {
            openWorkspace()
        }
        moduleCard(page, "SECURITY CENTER", "App Lock, screenshot protection and per-app network control") {
            openWorkspace()
        }

        page.addView(section("QUICK ACTIONS"))
        action(page, "OPEN FEATURE WORKSPACE") { openWorkspace() }
        action(page, "NOTIFICATION ACCESS SETTINGS") {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
        action(page, "APP PERMISSIONS") {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = android.net.Uri.parse("package:$packageName")
            })
        }

        page.addView(TextView(this).apply {
            text = "HONEST STATUS · A module is not marked operational merely because its screen exists. Device validation remains separate from emulator CI."
            textSize = 11f
            setTextColor(0xFF91A0AE.toInt())
            setPadding(0, dp(22), 0, dp(8))
        })
        setContentView(scroll)
    }

    private fun refreshSummary() {
        val listener = ComponentName(this, WhatsAppNotificationListener::class.java)
        val access = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
            ?.split(':')?.contains(listener.flattenToString()) == true
        val archive = runCatching { NotificationArchive.isEnabled(this) }.getOrDefault(false)
        val vaultCount = runCatching { MediaVault.list(this).size }.getOrNull()
        val chatCount = runCatching { WhatsAppExportArchive.list(this).size }.getOrNull()
        val timelineCount = runCatching { MessageTimeline.list(this).size }.getOrNull()
        val lock = runCatching { AppLock.isEnabled(this) }.getOrDefault(false)
        val vpn = runCatching { WhatsAppKillSwitchService.isEnabled(this) }.getOrDefault(false)

        summary.text = buildString {
            append("LOCAL SYSTEM STATUS\n")
            append("Notification access: ").append(if (access) "GRANTED" else "REQUIRED").append('\n')
            append("Archive capture: ").append(if (archive && access) "ENABLED" else "INACTIVE").append('\n')
            append("Media Vault: ").append(vaultCount?.let { "$it items" } ?: "UNAVAILABLE").append('\n')
            append("Imported chats: ").append(chatCount?.toString() ?: "UNAVAILABLE").append('\n')
            append("Timeline: ").append(timelineCount?.toString() ?: "UNAVAILABLE").append('\n')
            append("App Lock: ").append(if (lock) "ENABLED" else "DISABLED").append('\n')
            append("WhatsApp network block: ").append(if (vpn) "REPORTED ACTIVE" else "OFF")
        }
    }

    private fun moduleCard(parent: LinearLayout, title: String, detail: String, click: () -> Unit) {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(13), dp(14), dp(13))
            setBackgroundColor(0xFF101923.toInt())
        }
        card.addView(TextView(this).apply {
            text = title
            textSize = 14f
            letterSpacing = 0.05f
            setTextColor(0xFF00E68A.toInt())
        })
        card.addView(TextView(this).apply {
            text = detail
            textSize = 12f
            setTextColor(0xFFB7C2CC.toInt())
            setPadding(0, dp(5), 0, 0)
        })
        card.setOnClickListener { click() }
        val params = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(9) }
        parent.addView(card, params)
    }

    private fun section(label: String) = TextView(this).apply {
        text = label
        textSize = 11f
        letterSpacing = 0.12f
        setTextColor(0xFF91A0AE.toInt())
        setPadding(0, dp(18), 0, dp(9))
    }

    private fun action(parent: LinearLayout, label: String, click: () -> Unit) {
        val button = Button(this).apply {
            text = label
            isAllCaps = false
            setOnClickListener { click() }
        }
        parent.addView(button, LinearLayout.LayoutParams(-1, -2))
    }

    private fun openWorkspace() {
        startActivity(Intent(this, MainActivity::class.java))
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
