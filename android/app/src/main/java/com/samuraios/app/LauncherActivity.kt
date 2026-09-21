package com.samuraios.app

import android.content.ComponentName
import android.content.Intent
import android.content.pm.ResolveInfo
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.Button
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.view.setPadding
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class LauncherActivity : ComponentActivity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var clock: TextView
    private lateinit var grid: GridLayout
    private lateinit var status: TextView

    private val clockTick = object : Runnable {
        override fun run() {
            if (::clock.isInitialized) {
                clock.text = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
            }
            handler.postDelayed(this, 1000L)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildLauncher()
        loadApps()
        handler.post(clockTick)
    }

    override fun onResume() {
        super.onResume()
        if (::grid.isInitialized) loadApps()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun buildLauncher() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24)
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(Color.rgb(3, 7, 18), Color.rgb(10, 5, 25), Color.rgb(2, 14, 24))
            )
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val brand = TextView(this).apply {
            text = "SAMURAI·OS"
            textSize = 22f
            setTextColor(Color.rgb(0, 238, 255))
            typeface = Typeface.MONOSPACE
        }
        header.addView(brand, LinearLayout.LayoutParams(0, 60, 1f))

        clock = TextView(this).apply {
            textSize = 18f
            setTextColor(Color.WHITE)
            typeface = Typeface.MONOSPACE
            gravity = Gravity.CENTER
        }
        header.addView(clock, LinearLayout.LayoutParams(150, 60))
        root.addView(header)

        status = TextView(this).apply {
            text = "WORKSPACE // READY"
            textSize = 12f
            setTextColor(Color.rgb(100, 255, 180))
            typeface = Typeface.MONOSPACE
            setPadding(0, 0, 0, 18)
        }
        root.addView(status)

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        actions.addView(actionButton("REFRESH") { loadApps() })
        actions.addView(actionButton("TOOLS") {
            startActivity(Intent(this@LauncherActivity, MainActivity::class.java))
        })
        root.addView(actions)

        grid = GridLayout(this).apply {
            columnCount = 2
            useDefaultMargins = true
            alignmentMode = GridLayout.ALIGN_BOUNDS
        }
        root.addView(grid, LinearLayout.LayoutParams(-1, 0, 1f).apply { topMargin = 12 })
        setContentView(root)
    }

    private fun actionButton(label: String, onClick: () -> Unit): Button =
        Button(this).apply {
            text = label
            textSize = 11f
            setTextColor(Color.rgb(0, 238, 255))
            setOnClickListener { onClick() }
        }

    private fun loadApps() {
        grid.removeAllViews()
        val intent = Intent(Intent.ACTION_MAIN).apply { addCategory(Intent.CATEGORY_LAUNCHER) }
        val apps: List<ResolveInfo> = packageManager.queryIntentActivities(intent, 0)
            .filter { it.activityInfo.packageName != packageName }
            .sortedBy { it.loadLabel(packageManager).toString().lowercase(Locale.getDefault()) }

        status.text = "APPS // " + apps.size + " // WORKSPACE READY"

        apps.forEach { info ->
            val label = info.loadLabel(packageManager).toString()
            val button = TextView(this).apply {
                text = "◈\n" + label
                textSize = 15f
                gravity = Gravity.CENTER
                setTextColor(Color.WHITE)
                typeface = Typeface.MONOSPACE
                background = GradientDrawable().apply {
                    cornerRadius = 18f
                    setStroke(1, Color.rgb(0, 180, 210))
                    setColor(Color.argb(110, 8, 18, 35))
                }
                setPadding(12)
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    try {
                        val launchIntent = packageManager.getLaunchIntentForPackage(info.activityInfo.packageName)
                        if (launchIntent != null) startActivity(launchIntent)
                        else startActivity(Intent().apply {
                            component = ComponentName(info.activityInfo.packageName, info.activityInfo.name)
                        })
                    } catch (e: Exception) {
                        status.text = "LAUNCH ERROR // " + e.javaClass.simpleName
                    }
                }
            }

            val params = GridLayout.LayoutParams().apply {
                width = 0
                height = 150
                columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f)
                setMargins(8, 8, 8, 8)
            }
            grid.addView(button, params)
        }
    }
}
