package com.samurai.launcher

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class LauncherActivity : Activity() {
    private val bg = Color.rgb(15, 16, 18)
    private val panel = Color.rgb(29, 31, 35)
    private val accent = Color.rgb(75, 173, 184)
    private val white = Color.rgb(235, 237, 239)
    private val muted = Color.rgb(151, 157, 163)
    private val prefs by lazy { getSharedPreferences("samurai_launcher", MODE_PRIVATE) }
    private lateinit var appList: LinearLayout
    private lateinit var favoritesList: LinearLayout
    private lateinit var search: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(12, 13, 15)
        window.navigationBarColor = Color.rgb(12, 13, 15)
        window.decorView.systemUiVisibility = 0
        render()
    }

    override fun onResume() {
        super.onResume()
        if (::appList.isInitialized) {
            renderFavorites()
            loadApps(search.text.toString())
        }
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

        content.addView(label("SAMURAI", 30f, white, true))
        content.addView(label("MONOCHROME / X1", 11f, accent, true))
        content.addView(label("TACTICAL COMMAND", 12f, muted, true))
        content.addView(divider())
        content.addView(label("COMMAND CENTER", 18f, white, true))
        content.addView(card("SYSTEM STATUS", "Launcher interface active • Local-first\nNo telemetry • No background automation"))
        content.addView(card("GHOST SHIELD", "Informational dashboard only. Review and change permissions in Android settings."))
        content.addView(card("NEXUS", "Core API: NOT CONNECTED\nNo fabricated health or job status."))
        content.addView(card("COMMS", "WhatsApp Hybrid / Telegram\nInstalled apps can be opened from the drawer."))
        content.addView(label("FAVORITES", 18f, accent, true).apply { setPadding(0, 20, 0, 8) })
        content.addView(label("Long-press an app below to add or remove it.", 12f, muted, false))
        favoritesList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(favoritesList)
        content.addView(label("APP DRAWER", 18f, accent, true).apply { setPadding(0, 20, 0, 8) })

        search = EditText(this).apply {
            hint = "Search apps..."
            setSingleLine(true)
            setTextColor(white)
            setHintTextColor(muted)
            typeface = Typeface.create("sans-serif", Typeface.NORMAL)
            textSize = 16f
            background = roundedPanel(12, Color.rgb(65, 72, 78))
            setPadding(16, 12, 16, 12)
        }
        content.addView(search)
        content.addView(label("Tap to launch • Long-press to manage favorites", 12f, muted, false))
        appList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(appList)
        search.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                loadApps(s?.toString().orEmpty())
            }
            override fun afterTextChanged(s: android.text.Editable?) {}
        })
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
        renderFavorites()
        loadApps("")
    }

    private fun favoritePackages(): MutableSet<String> =
        prefs.getStringSet("favorite_packages", emptySet())?.toMutableSet() ?: mutableSetOf()

    private fun toggleFavorite(packageName: String) {
        val favorites = favoritePackages()
        if (!favorites.add(packageName)) favorites.remove(packageName)
        prefs.edit().putStringSet("favorite_packages", favorites).apply()
        renderFavorites()
        loadApps(search.text.toString())
    }

    private fun renderFavorites() {
        if (!::favoritesList.isInitialized) return
        favoritesList.removeAllViews()
        val favorites = favoritePackages()
        if (favorites.isEmpty()) {
            favoritesList.addView(label("No favorites yet", 13f, muted, false))
            return
        }
        favorites.sorted().forEach { packageName ->
            val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            if (launchIntent == null) {
                favorites.remove(packageName)
            } else {
                val title = runCatching {
                    packageManager.getApplicationLabel(packageManager.getApplicationInfo(packageName, 0)).toString()
                }.getOrDefault(packageName)
                favoritesList.addView(appRow(title, packageName, runCatching {
                    packageManager.getApplicationIcon(packageName)
                }.getOrNull(), true))
            }
        }
        prefs.edit().putStringSet("favorite_packages", favorites).apply()
    }

    private fun loadApps(query: String) {
        if (!::appList.isInitialized) return
        appList.removeAllViews()
        val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val apps = packageManager.queryIntentActivities(
            launcherIntent, PackageManager.MATCH_DEFAULT_ONLY
        ).mapNotNull { info ->
            val title = info.loadLabel(packageManager)?.toString() ?: return@mapNotNull null
            if (info.activityInfo.packageName == packageName || !title.contains(query, true)) {
                return@mapNotNull null
            }
            Triple(title, info.activityInfo.packageName, runCatching { info.loadIcon(packageManager) }.getOrNull())
        }.distinctBy { it.second }.sortedBy { it.first.lowercase() }

        if (apps.isEmpty()) {
            appList.addView(label("No launchable apps / no matches", 14f, muted, false))
            return
        }
        apps.forEach { (title, packageName, icon) ->
            appList.addView(appRow(title, packageName, icon, favoritePackages().contains(packageName)))
        }
    }

    private fun appRow(title: String, packageName: String, icon: Drawable?, favorite: Boolean): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(14, 10, 14, 10)
            background = roundedPanel(10, Color.rgb(49, 53, 58))
        }
        row.addView(ImageView(this).apply {
            setImageDrawable(icon ?: getDrawable(android.R.drawable.sym_def_app_icon))
            scaleType = ImageView.ScaleType.FIT_CENTER
            contentDescription = "$title icon"
        }, LinearLayout.LayoutParams(38, 38).apply { rightMargin = 14 })
        row.addView(TextView(this).apply {
            text = title
            textSize = 15f
            setTextColor(white)
            typeface = Typeface.create("sans-serif", Typeface.NORMAL)
        }, LinearLayout.LayoutParams(0, -2, 1f))
        row.addView(TextView(this).apply {
            text = if (favorite) "★" else "☆"
            textSize = 22f
            setTextColor(accent)
            contentDescription = if (favorite) "Favorite" else "Not favorite"
        })
        row.setOnClickListener {
            packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
                runCatching { startActivity(launch) }
            }
        }
        row.setOnLongClickListener {
            toggleFavorite(packageName)
            true
        }
        return row.apply {
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = 6 }
        }
    }

    private fun card(title: String, body: String): View {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16, 14, 16, 14)
            background = roundedPanel(12, Color.rgb(58, 64, 69))
        }
        box.addView(label(title, 13f, accent, true))
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
            typeface = if (bold) Typeface.create("sans-serif-condensed", Typeface.BOLD)
                       else Typeface.create("sans-serif", Typeface.NORMAL)
            setPadding(0, 4, 0, 4)
        }

    private fun roundedPanel(radiusDp: Int, strokeColor: Int): GradientDrawable =
        GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            intArrayOf(Color.rgb(35, 38, 42), Color.rgb(21, 23, 26))
        ).apply {
            cornerRadius = radiusDp * resources.displayMetrics.density
            setStroke((resources.displayMetrics.density).toInt().coerceAtLeast(1), strokeColor)
        }

    private fun divider(): View = View(this).apply {
        setBackgroundColor(accent)
        layoutParams = LinearLayout.LayoutParams(-1, 1).apply {
            topMargin = 12
            bottomMargin = 14
        }
    }
}
