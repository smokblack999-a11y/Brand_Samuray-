package com.samurai.whatsapp

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.util.TypedValue
import android.view.View
import android.view.animation.LinearInterpolator
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/**
 * Lightweight brand visual for the command dashboard.
 * It renders locally and does not represent a server, AI, or network health signal.
 */
internal class SamuraiCoreView(context: Context) : View(context) {
    private val density = resources.displayMetrics.density
    private var rotation = 0f
    private var animator: ValueAnimator? = null
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

    init {
        contentDescription = "SAMURAI decorative core visualization"
        setLayerType(LAYER_TYPE_SOFTWARE, null)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (animator == null) {
            animator = ValueAnimator.ofFloat(0f, 360f).apply {
                duration = 9_000L
                repeatCount = ValueAnimator.INFINITE
                interpolator = LinearInterpolator()
                addUpdateListener {
                    rotation = it.animatedValue as Float
                    invalidate()
                }
                start()
            }
        }
    }

    override fun onDetachedFromWindow() {
        animator?.cancel()
        animator = null
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val cx = width / 2f
        val cy = height / 2f
        val radius = min(width, height).toFloat() * 0.39f
        if (radius <= 0f) return

        paint.style = Paint.Style.FILL
        paint.shader = RadialGradient(
            cx, cy, radius * 1.25f,
            intArrayOf(Color.argb(62, 0, 236, 166), Color.argb(18, 0, 154, 198), Color.TRANSPARENT),
            floatArrayOf(0f, 0.55f, 1f),
            Shader.TileMode.CLAMP
        )
        canvas.drawCircle(cx, cy, radius * 1.25f, paint)
        paint.shader = null

        paint.style = Paint.Style.STROKE
        paint.strokeWidth = dp(1f)
        paint.color = Color.argb(95, 60, 174, 190)
        canvas.drawCircle(cx, cy, radius * 0.92f, paint)
        paint.color = Color.argb(150, 0, 231, 158)
        paint.strokeWidth = dp(1.5f)
        canvas.drawCircle(cx, cy, radius * 0.69f, paint)

        val bounds = RectF(
            cx - radius * 0.82f, cy - radius * 0.82f,
            cx + radius * 0.82f, cy + radius * 0.82f
        )
        paint.strokeWidth = dp(3f)
        paint.strokeCap = Paint.Cap.ROUND
        paint.color = Color.rgb(0, 231, 158)
        canvas.drawArc(bounds, rotation - 35f, 78f, false, paint)
        paint.color = Color.rgb(47, 179, 226)
        canvas.drawArc(bounds, -rotation + 145f, 34f, false, paint)

        canvas.save()
        canvas.rotate(rotation, cx, cy)
        paint.strokeWidth = dp(1.5f)
        paint.color = Color.argb(175, 89, 213, 231)
        for (index in 0 until 48) {
            val angle = Math.toRadians(index * 7.5)
            val outer = radius * 1.04f
            val inner = if (index % 4 == 0) radius * 0.90f else radius * 0.97f
            val x1 = cx + cos(angle).toFloat() * inner
            val y1 = cy + sin(angle).toFloat() * inner
            val x2 = cx + cos(angle).toFloat() * outer
            val y2 = cy + sin(angle).toFloat() * outer
            canvas.drawLine(x1, y1, x2, y2, paint)
        }
        canvas.restore()

        val hex = Path()
        for (index in 0 until 6) {
            val angle = Math.toRadians(index * 60.0 - 30.0)
            val x = cx + cos(angle).toFloat() * radius * 0.48f
            val y = cy + sin(angle).toFloat() * radius * 0.48f
            if (index == 0) hex.moveTo(x, y) else hex.lineTo(x, y)
        }
        hex.close()
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = dp(1.5f)
        paint.color = Color.argb(150, 0, 231, 158)
        canvas.drawPath(hex, paint)

        paint.style = Paint.Style.FILL
        paint.color = Color.argb(225, 8, 24, 34)
        canvas.drawCircle(cx, cy, radius * 0.36f, paint)
        paint.textAlign = Paint.Align.CENTER
        paint.typeface = android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD)
        paint.color = Color.rgb(227, 248, 244)
        paint.textSize = radius * 0.72f
        canvas.drawText("S", cx, cy + radius * 0.24f, paint)
        paint.color = Color.rgb(0, 235, 157)
        paint.textSize = dp(8f)
        canvas.drawText("SAMURAI CORE", cx, cy + radius * 0.54f, paint)
        paint.textAlign = Paint.Align.LEFT
    }

    private fun dp(value: Float): Float =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, resources.displayMetrics)
}
