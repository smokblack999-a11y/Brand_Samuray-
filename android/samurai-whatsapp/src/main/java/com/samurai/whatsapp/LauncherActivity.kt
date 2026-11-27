package com.samurai.whatsapp

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * SAMURAI command center. All metrics are read from local app state.
 * Feature workflows intentionally remain in MainActivity until migrated.
 */
class LauncherActivity : Activity() {
    private lateinit var summary: TextView
    private lateinit var notificationMetric: TextView
    private lateinit var vaultMetric: TextView
    private lateinit var chatMetric: TextView
    private lateinit var timelineMetric: TextView
    private lateinit var securityMetric: TextView
    private lateinit var networkMetric: TextView

    private val ink = Color.rgb(7, 12, 19)
    private val panel = Color.rgb(16, 26, 37)
    private val muted = Color.rgb(145, 161, 178)
    private val white = Color.rgb(235, 243, 249)
    private val mint = Color.rgb(0, 235, 157)
    private val cyan = Color.rgb(67, 202, 255)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = ink
        window.navigationBarColor = ink
        window.decorView.systemUiVisibility = 0
        render()
    }

    override fun onResume() {
        super.onResume()
        if (::summary.isInitialized) refreshSummary()
    }

    private fun render() {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(22), dp(20), dp(28))
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Color.rgb(9, 19, 29), ink, Color.rgb(5, 9, 15))
            )
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            overScrollMode = View.OVER_SCROLL_NEVER
            addView(page)
        }

        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        top.addView(label("S /", 18f, mint, true))
        top.addView(label("  SAMURAI SYSTEMS", 11f, white, true))
        val live = label("LOCAL MODE  ●", 10f, mint, true).apply {
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
        }
        top.addView(live, LinearLayout.LayoutParams(0, dp(30), 1f))
        page.addView(top)

        page.addView(label("CONTROL\nWITHOUT NOISE.", 31f, white, true).apply {
            letterSpacing = -0.035f
            setPadding(0, dp(27), 0, dp(8))
        })
        page.addView(label(
            "PRIVATE BY DESIGN. BUILT AROUND YOUR DEVICE.",
            10f, muted, true
        ).apply { letterSpacing = 0.08f })

        val hero = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(17), dp(17), dp(17), dp(17))
            background = rounded(
                intArrayOf(Color.rgb(18, 65, 66), Color.rgb(17, 37, 51)),
                dp(18)
            )
            elevation = dp(3).toFloat()
        }
        hero.addView(label("SYSTEM SNAPSHOT", 10f, mint, true))
        summary = label("Reading local state…", 13f, white, false).apply {
            setLineSpacing(dp(4).toFloat(), 1f)
            setPadding(0, dp(12), 0, dp(12))
        }
        hero.addView(summary)
        hero.addView(label(
            "Only locally observable states are shown. No cloud or device test is implied.",
            10f, Color.rgb(178, 207, 211), false
        ))
        page.addView(hero, spaced(-1, -2, 0, 0, 0, 0, dp(20)))

        page.addView(label("LIVE MODULE TELEMETRY", 10f, muted, true).apply {
            letterSpacing = 0.12f
            setPadding(0, 0, 0, dp(10))
        })
        val metrics = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val rowOne = metricRow()
        notificationMetric = metricValue(rowOne, "01  /  INBOX", "—", "Notification capture")
        vaultMetric = metricValue(rowOne, "02  /  VAULT", "—", "Encrypted media items")
        metrics.addView(rowOne)
        val rowTwo = metricRow()
        chatMetric = metricValue(rowTwo, "03  /  IMPORT", "—", "Imported chat archives")
        timelineMetric = metricValue(rowTwo, "04  /  TIMELINE", "—", "Recorded evidence events")
        metrics.addView(rowTwo)
        val rowThree = metricRow()
        securityMetric = metricValue(rowThree, "05  /  APP LOCK", "—", "Device authentication gate")
        networkMetric = metricValue(rowThree, "06  /  NETWORK", "—", "WhatsApp traffic control")
        metrics.addView(rowThree)
        page.addView(metrics)

        page.addView(label("COMMAND DECK", 10f, muted, true).apply {
            letterSpacing = 0.12f
            setPadding(0, dp(22), 0, dp(10))
        })
        moduleCard(page, "01", "MESSAGE INTELLIGENCE",
            "Notification archive · event timeline", "OPEN WORKSPACE") { openWorkspace() }
        moduleCard(page, "02", "PRIVATE MEDIA VAULT",
            "AES-GCM encrypted local media storage", "MANAGE MEDIA") { openWorkspace() }
        moduleCard(page, "03", "CHAT IMPORT",
            "Inspect your own TXT / ZIP exports", "OPEN ARCHIVES") { openWorkspace() }
        moduleCard(page, "04", "STATUS SAVER",
            "Access only media available through granted folders", "OPEN STATUS TOOLS") { openWorkspace() }
        moduleCard(page, "05", "SECURITY & NETWORK",
            "App Lock · screenshot protection · local VPN switch", "SECURITY CONTROLS") { openWorkspace() }

        page.addView(label("QUICK ACCESS", 10f, muted, true).apply {
            letterSpacing = 0.12f
            setPadding(0, dp(18), 0, dp(8))
        })
        action(page, "OPEN LEGACY FEATURE WORKSPACE") { openWorkspace() }
        action(page, "NOTIFICATION ACCESS SETTINGS") {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
        action(page, "ANDROID APP PERMISSIONS") {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = android.net.Uri.parse("package:$packageName")
            })
        }

        page.addView(label(
            "SAMURAI / HYBRID V1     •     LOCAL-FIRST CONTROL\nFeature screens are being migrated. Emulator CI is not physical-device validation.",
            10f, muted, false
        ).apply { setPadding(0, dp(20), 0, 0); setLineSpacing(dp(3).toFloat(), 1f) })
        setContentView(scroll)
        refreshSummary()
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

        notificationMetric.text = if (access && archive) "ACTIVE" else if (access) "PAUSED" else "SETUP"
        vaultMetric.text = vaultCount?.toString() ?: "N/A"
        chatMetric.text = chatCount?.toString() ?: "N/A"
        timelineMetric.text = timelineCount?.toString() ?: "N/A"
        securityMetric.text = if (lock) "LOCKED" else "OPEN"
        networkMetric.text = if (vpn) "BLOCKED" else "NORMAL"

        summary.text = buildString {
            append(if (access) "●  NOTIFICATION ACCESS GRANTED" else "○  NOTIFICATION ACCESS REQUIRED")
            append('\n')
            append(if (archive && access) "●  ARCHIVE CAPTURE ENABLED" else "○  ARCHIVE CAPTURE INACTIVE")
            append('\n')
            append("●  VAULT  ").append(vaultCount?.let { "$it encrypted items" } ?: "unavailable")
            append('\n')
            append("●  TIMELINE  ").append(timelineCount?.let { "$it recorded events" } ?: "unavailable")
        }
    }

    private fun metricRow() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        setPadding(0, 0, 0, dp(8))
    }

    private fun metricValue(row: LinearLayout, code: String, initial: String, caption: String): TextView {
        val cell = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(12), dp(10), dp(12))
            background = rounded(intArrayOf(Color.rgb(20, 33, 47), Color.rgb(13, 23, 34)), dp(13))
        }
        cell.addView(label(code, 9f, muted, true))
        val value = label(initial, 20f, mint, true).apply { setPadding(0, dp(7), 0, dp(3)) }
        cell.addView(value)
        cell.addView(label(caption, 10f, white, false))
        row.addView(cell, LinearLayout.LayoutParams(0, dp(91), 1f).apply {
            if (row.childCount == 0) marginEnd = dp(7) else marginStart = dp(7)
        })
        return value
    }

    private fun moduleCard(
        parent: LinearLayout,
        number: String,
        title: String,
        detail: String,
        actionLabel: String,
        click: () -> Unit
    ) {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(13), dp(13), dp(13), dp(13))
            background = rounded(intArrayOf(Color.rgb(18, 29, 42), Color.rgb(12, 20, 30)), dp(14))
            isClickable = true
            isFocusable = true
            setOnClickListener { click() }
            elevation = dp(1).toFloat()
        }
        val index = label(number, 13f, cyan, true).apply { gravity = Gravity.TOP }
        card.addView(index, LinearLayout.LayoutParams(dp(30), -2))
        val textBlock = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        textBlock.addView(label(title, 12f, white, true))
        textBlock.addView(label(detail, 10f, muted, false).apply { setPadding(0, dp(4), 0, dp(5)) })
        textBlock.addView(label("$actionLabel   ↗", 9f, mint, true))
        card.addView(textBlock, LinearLayout.LayoutParams(0, -2, 1f))
        parent.addView(card, spaced(-1, -2, 0, 0, 0, 0, dp(8)))
    }

    private fun action(parent: LinearLayout, title: String, click: () -> Unit) {
        val button = Button(this).apply {
            text = title
            isAllCaps = false
            textSize = 10f
            letterSpacing = 0.04f
            setTextColor(white)
            background = rounded(intArrayOf(Color.rgb(22, 39, 53), Color.rgb(15, 27, 39)), dp(11))
            setOnClickListener { click() }
        }
        parent.addView(button, spaced(-1, dp(46), 0, 0, 0, 0, dp(7)))
    }

    private fun label(value: String, size: Float, color: Int, bold: Boolean) =
        TextView(this).apply {
            text = value
            textSize = size
            setTextColor(color)
            typeface = if (bold) Typeface.create("sans-serif", Typeface.BOLD)
                else Typeface.create("sans-serif", Typeface.NORMAL)
        }

    private fun rounded(colors: IntArray, radius: Int) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR, colors
    ).apply { cornerRadius = radius.toFloat() }

    private fun spaced(
        width: Int, height: Int, left: Int, top: Int, right: Int, bottom: Int, after: Int
    ) = LinearLayout.LayoutParams(width, height).apply {
        setMargins(left, top, right, bottom + after)
    }

    private fun openWorkspace() {
        startActivity(Intent(this, MainActivity::class.java))
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()
}
