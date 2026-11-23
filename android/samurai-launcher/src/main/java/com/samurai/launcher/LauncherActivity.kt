package com.samurai.launcher

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class LauncherActivity : Activity() {
    private val bg = Color.rgb(8, 9, 12)
    private val panel = Color.rgb(20, 22, 27)
    private val red = Color.rgb(230, 38, 48)
    private val white = Color.rgb(240, 242, 245)
    private val muted = Color.rgb(145, 150, 158)
    private lateinit var appList: LinearLayout
    private lateinit var search: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        render()
    }

    override fun onResume() {
        super.onResume()
        if (::appList.isInitialized) loadApps(search.text.toString())
    }

    private fun render() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(22, 26, 22, 18)
            setBackgroundColor(bg)
        }
        val scroll = ScrollView(this)
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(content)

        content.addView(label("SAMURAI", 30f, red, true))
        content.addView(label("TACTICAL COMMAND / X1", 12f, muted, true))
        content.addView(divider())
        content.addView(label("COMMAND CENTER", 18f, white, true))
        content.addView(card("SYSTEM STATUS", "Launcher interface active • Local-first\nNo telemetry • No background automation"))
        content.addView(card("GHOST SHIELD", "Informational dashboard only. Review and change permissions in Android settings."))
        content.addView(card("NEXUS", "Core API: NOT CONNECTED\nNo fabricated health or job status."))
        content.addView(card("COMMS", "WhatsApp Hybrid / Telegram\nInstalled apps can be opened from the drawer."))
        content.addView(label("APP DRAWER", 18f, red, true).apply { setPadding(0, 20, 0, 8) })

        search = EditText(this).apply {
            hint = "Search apps..."
            setSingleLine(true)
            setTextColor(white)
            setHintTextColor(muted)
            setBackgroundColor(panel)
            setPadding(16, 12, 16, 12)
        }
        content.addView(search)
        search.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                loadApps(s?.toString().orEmpty())
            }
            override fun afterTextChanged(s: android.text.Editable?) {}
        })

        appList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(appList)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
        loadApps("")
    }

    private fun loadApps(query: String) {
        if (!::appList.isInitialized) return
        appList.removeAllViews()
        val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val apps = packageManager.queryIntentActivities(
            launcherIntent,
            PackageManager.MATCH_DEFAULT_ONLY
        ).mapNotNull { info ->
            val title = info.loadLabel(packageManager)?.toString() ?: return@mapNotNull null
            if (info.activityInfo.packageName == packageName || !title.contains(query, true)) {
                return@mapNotNull null
            }
            title to info
        }.sortedBy { it.first.lowercase() }

        if (apps.isEmpty()) {
            appList.addView(label("No launchable apps / no matches", 14f, muted, false))
            return
        }

        apps.forEach { (title, info) ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(14, 12, 14, 12)
                setBackgroundColor(panel)
            }
            row.addView(TextView(this).apply {
                text = "◆"
                textSize = 20f
                setTextColor(red)
                setPadding(0, 0, 14, 0)
            })
            row.addView(TextView(this).apply {
                text = title
                textSize = 16f
                setTextColor(white)
                typeface = Typeface.DEFAULT
            }, LinearLayout.LayoutParams(0, -2, 1f))
            row.setOnClickListener {
                packageManager.getLaunchIntentForPackage(info.activityInfo.packageName)?.let { launch ->
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    runCatching { startActivity(launch) }
                }
            }
            appList.addView(row, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = 6 })
        }
    }

    private fun card(title: String, body: String): View {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16, 14, 16, 14)
            setBackgroundColor(panel)
        }
        box.addView(label(title, 13f, red, true))
        box.addView(label(body, 13f, white, false).apply { setPadding(0, 8, 0, 0) })
        return box.apply {
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = 8 }
        }
    }

    private fun label(text: String, size: Float, color: Int, bold: Boolean): TextView =
        TextView(this).apply {
            this.text = text
            textSize = size
            setTextColor(color)
            if (bold) typeface = Typeface.create("sans-serif-condensed", Typeface.BOLD)
            setPadding(0, 4, 0, 4)
        }

    private fun divider(): View = View(this).apply {
        setBackgroundColor(red)
        layoutParams = LinearLayout.LayoutParams(-1, 2).apply {
            topMargin = 12
            bottomMargin = 14
        }
    }
}
