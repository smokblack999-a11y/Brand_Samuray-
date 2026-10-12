package com.samuraios.app

import android.app.Activity
import android.content.Intent
import android.content.pm.ResolveInfo
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Real Android HOME activity: lists installed launchable activities and opens them. */
class LauncherActivity : Activity() {
    private val black = Color.rgb(4, 3, 2)
    private val gold = Color.rgb(201, 161, 74)
    private val red = Color.rgb(196, 40, 45)
    private val ivory = Color.rgb(244, 239, 225)
    private lateinit var appList: LinearLayout
    private lateinit var search: EditText
    private var launchables: List<ResolveInfo> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = black
        window.navigationBarColor = black
        buildScreen()
        loadLaunchableApps()
    }

    override fun onResume() {
        super.onResume()
        if (::appList.isInitialized) loadLaunchableApps()
    }

    private fun buildScreen() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(22), dp(22), dp(12))
            setBackgroundColor(black)
        }
        root.addView(TextView(this).apply {
            text = "SAMURAI®"
            textSize = 34f
            letterSpacing = 0.08f
            typeface = Typeface.create("sans-serif-condensed", Typeface.BOLD)
            setTextColor(gold)
        })
        root.addView(TextView(this).apply {
            text = "HOME SYSTEM  /  " + SimpleDateFormat("EEE, dd MMM", Locale.getDefault()).format(Date()).uppercase(Locale.getDefault())
            textSize = 11f
            letterSpacing = 0.12f
            setTextColor(red)
            setPadding(0, dp(3), 0, dp(18))
        })
        root.addView(TextView(this).apply {
            text = "YOUR DEVICE. YOUR RULES."
            textSize = 18f
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            setTextColor(ivory)
        })
        root.addView(TextView(this).apply {
            text = "Installed applications"
            textSize = 13f
            setTextColor(gold)
            setPadding(0, dp(5), 0, dp(12))
        })
        search = EditText(this).apply {
            hint = "Search apps"
            setSingleLine(true)
            textSize = 15f
            setTextColor(ivory)
            setHintTextColor(Color.rgb(135, 128, 115))
            setPadding(dp(12), dp(8), dp(12), dp(8))
            setBackgroundColor(Color.rgb(25, 22, 18))
            addTextChangedListener(SimpleTextWatcher { renderApps(it) })
        }
        root.addView(search, LinearLayout.LayoutParams(-1, dp(48)))
        root.addView(TextView(this).apply {
            setBackgroundColor(gold)
            text = ""
        }, LinearLayout.LayoutParams(-1, dp(1)).apply {
            topMargin = dp(12)
            bottomMargin = dp(8)
        })
        val scroll = ScrollView(this).apply { isFillViewport = true }
        appList = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(4), 0, dp(12))
        }
        scroll.addView(appList, ViewGroup.LayoutParams(-1, -2))
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(TextView(this).apply {
            text = "SAMURAI LAUNCHER • MVP"
            textSize = 10f
            letterSpacing = 0.1f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(120, 112, 96))
            setPadding(0, dp(10), 0, dp(4))
        })
        setContentView(root)
    }

    private fun loadLaunchableApps() {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        launchables = packageManager.queryIntentActivities(intent, 0)
            .filter { it.activityInfo?.packageName != packageName }
            .distinctBy { "${it.activityInfo?.packageName}/${it.activityInfo?.name}" }
            .sortedBy { it.loadLabel(packageManager).toString().lowercase(Locale.getDefault()) }
        renderApps(search.text.toString())
    }

    private fun renderApps(query: String) {
        if (!::appList.isInitialized) return
        appList.removeAllViews()
        val normalized = query.trim().lowercase(Locale.getDefault())
        val filtered = launchables.filter {
            it.loadLabel(packageManager).toString().lowercase(Locale.getDefault()).contains(normalized)
        }
        if (filtered.isEmpty()) {
            appList.addView(TextView(this).apply {
                text = if (launchables.isEmpty()) "No launchable apps were found." else "No apps match this search."
                textSize = 14f
                setTextColor(Color.LTGRAY)
                setPadding(dp(8), dp(18), dp(8), dp(18))
            })
            return
        }
        filtered.forEach { resolveInfo ->
            val info = resolveInfo.activityInfo ?: return@forEach
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(10), dp(9), dp(10), dp(9))
                setBackgroundColor(Color.rgb(15, 13, 11))
                isClickable = true
                isFocusable = true
                setOnClickListener { launchApp(info.packageName, info.name) }
            }
            val icon = ImageView(this).apply {
                setImageDrawable(resolveInfo.loadIcon(packageManager))
                contentDescription = resolveInfo.loadLabel(packageManager).toString()
                scaleType = ImageView.ScaleType.FIT_CENTER
            }
            row.addView(icon, LinearLayout.LayoutParams(dp(42), dp(42)))
            val labels = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(12), 0, 0, 0)
            }
            labels.addView(TextView(this).apply {
                text = resolveInfo.loadLabel(packageManager).toString()
                textSize = 15f
                typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
                setTextColor(ivory)
                maxLines = 1
            })
            labels.addView(TextView(this).apply {
                text = info.packageName
                textSize = 10f
                setTextColor(Color.rgb(145, 132, 108))
                maxLines = 1
            })
            row.addView(labels, LinearLayout.LayoutParams(0, -2, 1f))
            row.addView(TextView(this).apply {
                text = "OPEN  ›"
                textSize = 10f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(gold)
            })
            appList.addView(row, LinearLayout.LayoutParams(-1, -2).apply {
                bottomMargin = dp(6)
            })
        }
    }

    private fun launchApp(packageName: String, activityName: String) {
        try {
            val launch = Intent(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_LAUNCHER)
                setClassName(packageName, activityName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(launch)
        } catch (_: Exception) {
            Toast.makeText(this, "Unable to open this app", Toast.LENGTH_SHORT).show()
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
