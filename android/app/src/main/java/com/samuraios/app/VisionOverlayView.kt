package com.samuraios.app

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import kotlin.math.max
import kotlin.math.min

/** Transparent overlay for local CameraX/ML Kit detections in PreviewView pixels. */
class VisionOverlayView(context: Context) : View(context) {
    private val density = resources.displayMetrics.density
    private val boxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.CYAN
        style = Paint.Style.STROKE
        strokeWidth = 2.5f * density
    }
    private val labelBackgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(220, 3, 18, 28)
        style = Paint.Style.FILL
    }
    private val labelTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 13f * density
        typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.BOLD)
    }
    @Volatile private var detections: List<VisionOverlayDetection> = emptyList()

    init {
        setWillNotDraw(false)
        isClickable = false
        isFocusable = false
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
        contentDescription = "Локальное зрение: ожидание объектов"
    }

    fun setDetections(items: List<VisionOverlayDetection>) {
        detections = items.map { it.copy(bounds = RectF(it.bounds)) }
        contentDescription = if (items.isEmpty()) {
            "Локальное зрение: видимые объекты не обнаружены"
        } else {
            items.joinToString(separator = "; ") { item ->
                item.label + (item.trackingId?.let { " номер " + it } ?: "")
            }
        }
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val snapshot = detections
        if (snapshot.isEmpty()) return

        val padding = 6f * density
        val radius = 6f * density
        val tagHeight = labelTextPaint.textSize + padding * 2
        snapshot.forEach { item ->
            val bounds = RectF(item.bounds)
            if (bounds.width() < 2f || bounds.height() < 2f) return@forEach
            canvas.drawRoundRect(bounds, radius, radius, boxPaint)

            val confidence = (item.confidence.coerceIn(0f, 1f) * 100f).toInt()
            val tracking = item.trackingId?.let { " #" + it } ?: ""
            val label = item.label + " " + confidence + "%" + tracking
            val tagWidth = labelTextPaint.measureText(label) + padding * 2
            val tagLeft = bounds.left.coerceIn(0f, max(0f, width.toFloat() - tagWidth))
            val tagTop = (bounds.top - tagHeight).coerceAtLeast(0f)
            val tag = RectF(
                tagLeft,
                tagTop,
                min(width.toFloat(), tagLeft + tagWidth),
                min(height.toFloat(), tagTop + tagHeight)
            )
            canvas.drawRoundRect(tag, radius, radius, labelBackgroundPaint)
            canvas.drawText(label, tag.left + padding, tag.bottom - padding, labelTextPaint)
        }
    }
}