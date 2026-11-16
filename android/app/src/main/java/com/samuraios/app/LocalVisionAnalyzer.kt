package com.samuraios.app

import android.graphics.Matrix
import android.graphics.RectF
import androidx.annotation.OptIn
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.view.PreviewView
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.objects.DetectedObject
import com.google.mlkit.vision.objects.ObjectDetection
import com.google.mlkit.vision.objects.defaults.ObjectDetectorOptions
import java.util.Locale

data class VisionOverlayDetection(
    val bounds: RectF,
    val label: String,
    val confidence: Float,
    val trackingId: Int?
)

/** On-device live object detection. Camera frames are never uploaded by this analyzer. */
class LocalVisionAnalyzer(
    private val previewView: PreviewView,
    private val onFrameResult: (String, List<VisionOverlayDetection>) -> Unit
) : ImageAnalysis.Analyzer, AutoCloseable {
    private val detector = ObjectDetection.getClient(
        ObjectDetectorOptions.Builder()
            .setDetectorMode(ObjectDetectorOptions.STREAM_MODE)
            .enableClassification()
            .build()
    )

    private val stateLock = Any()
    private var acceptingFrames = true
    private var processingFrame = false
    private var closePending = false
    private var detectorClosed = false
    @Volatile private var lastUiUpdateAt = 0L
    @Volatile private var lastFailureAt = 0L

    @OptIn(markerClass = [ExperimentalGetImage::class])
    override fun analyze(imageProxy: ImageProxy) {
        val acquired = synchronized(stateLock) {
            if (!acceptingFrames || processingFrame) {
                false
            } else {
                processingFrame = true
                true
            }
        }
        if (!acquired) {
            imageProxy.close()
            return
        }

        try {
            val mediaImage = imageProxy.image
            if (mediaImage == null) {
                finishFrame(imageProxy)
                return
            }

            val inputImage = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
            detector.process(inputImage)
                .addOnSuccessListener { objects ->
                    if (!isAccepting()) return@addOnSuccessListener
                    val matrix = getCorrectionMatrix(imageProxy)
                    val detections = if (matrix == null) emptyList() else objects.mapNotNull { item ->
                        mapDetection(item, matrix)
                    }
                    val labels = detections.map { item ->
                        val confidence = String.format(Locale.US, "%.0f%%", item.confidence * 100f)
                        val tracking = item.trackingId?.let { " #" + it } ?: ""
                        item.label + " " + confidence + tracking
                    }
                    val status = if (objects.isEmpty()) {
                        "Локальное зрение · объектов не обнаружено"
                    } else {
                        "Локальное зрение · " + objects.size + " объект(а)\n" + labels.joinToString("\n")
                    }
                    val now = System.currentTimeMillis()
                    if (now - lastUiUpdateAt >= 120L) {
                        lastUiUpdateAt = now
                        runCatching { onFrameResult(status, detections) }
                    }
                }
                .addOnFailureListener { error ->
                    if (!isAccepting()) return@addOnFailureListener
                    val now = System.currentTimeMillis()
                    if (now - lastFailureAt >= 2000L) {
                        lastFailureAt = now
                        runCatching {
                            onFrameResult(
                                "Локальное зрение: анализ кадра недоступен · " +
                                    (error.localizedMessage ?: "ошибка ML Kit"),
                                emptyList()
                            )
                        }
                    }
                }
                .addOnCompleteListener {
                    finishFrame(imageProxy)
                }
        } catch (error: Exception) {
            val now = System.currentTimeMillis()
            if (isAccepting() && now - lastFailureAt >= 2000L) {
                lastFailureAt = now
                runCatching {
                    onFrameResult(
                        "Локальное зрение: ошибка кадра · " +
                            (error.localizedMessage ?: error.javaClass.simpleName),
                        emptyList()
                    )
                }
            }
            finishFrame(imageProxy)
        }
    }

    private fun mapDetection(item: DetectedObject, matrix: Matrix): VisionOverlayDetection? {
        val previewWidth = previewView.width.toFloat()
        val previewHeight = previewView.height.toFloat()
        if (previewWidth <= 0f || previewHeight <= 0f) return null

        val mapped = RectF()
        if (!matrix.mapRect(mapped, RectF(item.boundingBox))) return null
        if (!mapped.intersect(0f, 0f, previewWidth, previewHeight)) return null

        val best = item.labels.maxByOrNull { it.confidence }
        val rawLabel = best?.text?.lowercase(Locale.ROOT).orEmpty()
        val localizedLabel = when (rawLabel) {
            "fashion goods" -> "одежда"
            "food" -> "еда"
            "home goods" -> "дом"
            "places" -> "место"
            "plants" -> "растение"
            else -> "объект"
        }
        return VisionOverlayDetection(
            bounds = mapped,
            label = localizedLabel,
            confidence = best?.confidence ?: 0f,
            trackingId = item.trackingId
        )
    }

    /** Maps ImageAnalysis crop/rotation coordinates into PreviewView pixels. */
    private fun getCorrectionMatrix(imageProxy: ImageProxy): Matrix? {
        val previewWidth = previewView.width
        val previewHeight = previewView.height
        if (previewWidth <= 0 || previewHeight <= 0) return null

        val cropRect = imageProxy.cropRect
        val rotationDegrees = imageProxy.imageInfo.rotationDegrees
        if (rotationDegrees % 90 != 0) return null

        val source = floatArrayOf(
            cropRect.left.toFloat(), cropRect.top.toFloat(),
            cropRect.right.toFloat(), cropRect.top.toFloat(),
            cropRect.right.toFloat(), cropRect.bottom.toFloat(),
            cropRect.left.toFloat(), cropRect.bottom.toFloat()
        )
        val destination = floatArrayOf(
            0f, 0f,
            previewWidth.toFloat(), 0f,
            previewWidth.toFloat(), previewHeight.toFloat(),
            0f, previewHeight.toFloat()
        )
        val shiftOffset = (rotationDegrees / 90) * 2
        val originalDestination = destination.clone()
        for (index in source.indices) {
            val fromIndex = (index + shiftOffset) % source.size
            destination[index] = originalDestination[fromIndex]
        }

        val matrix = Matrix()
        return matrix.takeIf { it.setPolyToPoly(source, 0, destination, 0, 4) }
    }

    private fun isAccepting(): Boolean = synchronized(stateLock) { acceptingFrames }

    private fun finishFrame(imageProxy: ImageProxy) {
        try {
            imageProxy.close()
        } finally {
            synchronized(stateLock) {
                processingFrame = false
                if (closePending) closeDetectorLocked()
            }
        }
    }

    override fun close() {
        synchronized(stateLock) {
            acceptingFrames = false
            closePending = true
            if (!processingFrame) closeDetectorLocked()
        }
    }

    private fun closeDetectorLocked() {
        if (!detectorClosed) {
            detectorClosed = true
            detector.close()
        }
        closePending = false
    }
}