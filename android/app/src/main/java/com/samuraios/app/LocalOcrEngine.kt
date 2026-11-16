package com.samuraios.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.exifinterface.media.ExifInterface
import com.googlecode.tesseract.android.TessBaseAPI
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.min

data class LocalOcrResult(val text: String, val meanConfidence: Int, val elapsedMs: Long)

/** Offline still-image OCR. Only model bootstrap needs network; recognition is local. */
class LocalOcrEngine(private val context: Context) {
    companion object {
        private const val MODEL_REVISION = "87416418657359cb625c412a48b6e1d6d41c29bd"
        private const val MODEL_BASE = "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/$MODEL_REVISION/"
        private val MODELS = mapOf(
            "rus" to Model("rus.traineddata", 3_861_738L, "b146cb2263acbc6383f8e92ea0ce759537687bb8"),
            "kaz" to Model("kaz.traineddata", 4_734_644L, "f889e2b8ffd093d4f2dff8ffca2fa0b73296c028")
        )
        private const val MAX_SOURCE_BYTES = 12L * 1024L * 1024L
        private const val MAX_PIXELS = 12_000_000
        private const val MAX_SIDE = 2400
    }

    private data class Model(val fileName: String, val size: Long, val gitBlobSha1: String)

    fun recognize(photo: File, cancelled: AtomicBoolean = AtomicBoolean(false)): LocalOcrResult {
        require(photo.isFile && photo.length() in 1..MAX_SOURCE_BYTES) { "Фото отсутствует или превышает лимит 12 MB" }
        val started = System.nanoTime()
        val dataRoot = File(context.filesDir, "samurai-ocr").apply {
            if (!exists() && !mkdirs()) error("Не удалось создать каталог OCR")
        }
        val tessData = File(dataRoot, "tessdata").apply {
            if (!exists() && !mkdirs()) error("Не удалось создать каталог языковых моделей")
        }
        MODELS.values.forEach { model ->
            if (cancelled.get()) throw InterruptedException("OCR отменён")
            ensureModel(tessData, model)
        }
        if (cancelled.get()) throw InterruptedException("OCR отменён")

        val bitmap = decodeBounded(photo)
        val api = TessBaseAPI()
        try {
            check(api.init(dataRoot.absolutePath, "rus+kaz")) { "Tesseract не смог загрузить модели rus+kaz" }
            api.setPageSegMode(TessBaseAPI.PageSegMode.PSM_AUTO)
            api.setImage(bitmap)
            if (cancelled.get()) throw InterruptedException("OCR отменён")
            val text = api.getUTF8Text()?.trim().orEmpty()
            val confidence = api.meanConfidence()
            if (cancelled.get()) throw InterruptedException("OCR отменён")
            return LocalOcrResult(text, confidence, (System.nanoTime() - started) / 1_000_000L)
        } finally {
            api.recycle()
            bitmap.recycle()
        }
    }

    private fun ensureModel(directory: File, model: Model) {
        val target = File(directory, model.fileName)
        if (target.isFile && target.length() == model.size && gitBlobSha1(target) == model.gitBlobSha1) return
        target.delete()
        val temp = File(directory, model.fileName + ".part")
        temp.delete()
        var connection: HttpURLConnection? = null
        try {
            connection = (URL(MODEL_BASE + model.fileName).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15000
                readTimeout = 60000
                instanceFollowRedirects = false
                useCaches = false
                setRequestProperty("Accept", "application/octet-stream")
            }
            check(connection.responseCode == HttpURLConnection.HTTP_OK) { "Не удалось загрузить модель ${model.fileName}: HTTP ${connection.responseCode}" }
            check(connection.contentLengthLong == -1L || connection.contentLengthLong == model.size) { "Размер модели не совпадает с manifest" }
            connection.inputStream.use { input ->
                FileOutputStream(temp).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        check(total <= model.size) { "Модель больше ожидаемого размера" }
                        output.write(buffer, 0, count)
                    }
                    output.fd.sync()
                    check(total == model.size) { "Неполная загрузка модели" }
                }
            }
            check(gitBlobSha1(temp) == model.gitBlobSha1) { "Проверка целостности модели не пройдена" }
            check(temp.renameTo(target)) { "Не удалось атомарно установить OCR-модель" }
        } finally {
            connection?.disconnect()
            temp.delete()
        }
    }

    private fun gitBlobSha1(file: File): String {
        val digest = MessageDigest.getInstance("SHA-1")
        digest.update(("blob " + file.length().toString() + "\u0000").toByteArray(Charsets.UTF_8))
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun decodeBounded(file: File): Bitmap {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        require(bounds.outWidth > 0 && bounds.outHeight > 0) { "Файл не является корректным изображением" }
        require(bounds.outWidth.toLong() * bounds.outHeight.toLong() <= 80_000_000L) { "Слишком большое изображение" }
        var sample = 1
        while (max(bounds.outWidth / sample, bounds.outHeight / sample) > MAX_SIDE ||
            (bounds.outWidth.toLong() / sample) * (bounds.outHeight.toLong() / sample) > MAX_PIXELS) {
            sample *= 2
        }
        val options = BitmapFactory.Options().apply { inSampleSize = sample; inPreferredConfig = Bitmap.Config.ARGB_8888 }
        val decoded = BitmapFactory.decodeFile(file.absolutePath, options) ?: error("Не удалось декодировать изображение")
        val orientation = runCatching { ExifInterface(file).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
            .getOrDefault(ExifInterface.ORIENTATION_NORMAL)
        val matrix = android.graphics.Matrix().apply {
            when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90 -> postRotate(90f)
                ExifInterface.ORIENTATION_ROTATE_180 -> postRotate(180f)
                ExifInterface.ORIENTATION_ROTATE_270 -> postRotate(270f)
                ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> postScale(-1f, 1f)
                ExifInterface.ORIENTATION_FLIP_VERTICAL -> postScale(1f, -1f)
            }
        }
        if (matrix.isIdentity) return decoded
        return try {
            Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true).also { if (it !== decoded) decoded.recycle() }
        } catch (error: Exception) {
            decoded.recycle()
            throw error
        }
    }
}