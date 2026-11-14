package com.samuraios.app

import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.objects.ObjectDetection
import com.google.mlkit.vision.objects.defaults.ObjectDetectorOptions
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

/** On-device object detection for live CameraX frames. No frames leave the device. */
class LocalVisionAnalyzer(private val onStatus: (String) -> Unit) : ImageAnalysis.Analyzer, AutoCloseable {
    private val detector = ObjectDetection.getClient(
        ObjectDetectorOptions.Builder()
            .setDetectorMode(ObjectDetectorOptions.STREAM_MODE)
            .enableMultipleObjects()
            .enableClassification()
            .build()
    )
    private val inFlight = AtomicBoolean(false)
    private var lastStatusAt = 0L

    override fun analyze(imageProxy: ImageProxy) {
        val mediaImage = imageProxy.image
        if (mediaImage == null || !inFlight.compareAndSet(false, true)) {
            imageProxy.close()
            return
        }

        try {
            val inputImage = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
            detector.process(inputImage)
                .addOnSuccessListener { objects ->
                    val now = System.currentTimeMillis()
                    if (now - lastStatusAt < 700L) return@addOnSuccessListener
                    lastStatusAt = now
                    val labels = objects.take(5).map { item ->
                        val best = item.labels.maxByOrNull { it.confidence }
                        val name = best?.text ?: "объект"
                        val confidence = best?.confidence?.let { " " + String.format(Locale.US, "%.0f%%", it * 100f) } ?: ""
                        val tracking = item.trackingId?.let { " #$it" } ?: ""
                        name + confidence + tracking
                    }
                    val status = if (labels.isEmpty()) {
                        "Локальное зрение · объектов не обнаружено"
                    } else {
                        "Локальное зрение · ${objects.size} объектов\n" + labels.joinToString("\n")
                    }
                    onStatus(status)
                }
                .addOnFailureListener { error ->
                    val now = System.currentTimeMillis()
                    if (now - lastStatusAt >= 2000L) {
                        lastStatusAt = now
                        onStatus("Локальное зрение: модель недоступна · ${error.localizedMessage ?: "проверьте Google Play services и подключение для первой загрузки модели"}")
                    }
                }
                .addOnCompleteListener {
                    inFlight.set(false)
                    imageProxy.close()
                }
        } catch (error: Exception) {
            inFlight.set(false)
            imageProxy.close()
            val now = System.currentTimeMillis()
            if (now - lastStatusAt >= 2000L) {
                lastStatusAt = now
                onStatus("Локальное зрение: ошибка кадра · ${error.localizedMessage ?: error.javaClass.simpleName}")
            }
        }
    }

    override fun close() {
        detector.close()
    }
}
