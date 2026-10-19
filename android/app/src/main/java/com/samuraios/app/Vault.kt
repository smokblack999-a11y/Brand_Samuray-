package com.samuraios.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.Matrix
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.io.File
import org.json.JSONObject

object Vault {

    private const val DIRECTORY = "photos"

    fun directory(context: Context): File {
        return File(context.filesDir, DIRECTORY).apply {
            if (!exists()) mkdirs()
        }
    }

    fun createPhotoFile(context: Context): File {
        return File(directory(context), "samurai_${System.currentTimeMillis()}.jpg")
    }

    fun importPhoto(context: Context, uri: Uri): File {
        val file = createPhotoFile(context)
        context.contentResolver.openInputStream(uri).use { input ->
            requireNotNull(input) { "Не удалось открыть изображение" }
            file.outputStream().use { output -> input.copyTo(output) }
        }
        return file
    }

    fun metadataFile(photo: File): File = File(photo.parentFile, "${photo.nameWithoutExtension}.json")

    fun saveMetadata(photo: File, latitude: Double?, longitude: Double?, accuracy: Float?, timestamp: Long) {
        val json = JSONObject().apply {
            put("timestamp", timestamp)
            put("latitude", latitude ?: JSONObject.NULL)
            put("longitude", longitude ?: JSONObject.NULL)
            put("accuracyMeters", accuracy ?: JSONObject.NULL)
        }
        val validGps = latitude != null && longitude != null &&
            latitude.isFinite() && longitude.isFinite() &&
            latitude in -90.0..90.0 && longitude in -180.0..180.0
        val stampApplied = if (validGps) {
            runCatching { stampCoordinates(photo, latitude!!, longitude!!, accuracy, timestamp) }.getOrDefault(false)
        } else false

        // Keep GPS in standard JPEG EXIF as well as in the app's sidecar JSON.
        // If no valid fix exists, do not fabricate coordinates.
        if (latitude != null && longitude != null &&
            latitude.isFinite() && longitude.isFinite() &&
            latitude in -90.0..90.0 && longitude in -180.0..180.0
        ) {
            runCatching {
                ExifInterface(photo.absolutePath).apply {
                    setLatLong(latitude, longitude)
                    val formatted = SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.US).format(Date(timestamp))
                    setAttribute(ExifInterface.TAG_DATETIME, formatted)
                    setAttribute(ExifInterface.TAG_DATETIME_ORIGINAL, formatted)
                    saveAttributes()
                }
            }
        }
        json.put("visibleGpsStamp", stampApplied)
        metadataFile(photo).writeText(json.toString())
    }

    fun metadata(photo: File): JSONObject? = runCatching {
        JSONObject(metadataFile(photo).readText())
    }.getOrNull()

    fun listPhotos(context: Context): List<File> {
        return directory(context).listFiles()
            ?.filter { it.isFile && it.extension.lowercase() == "jpg" }
            ?.sortedByDescending { it.lastModified() }
            ?: emptyList()
    }

    fun deletePhoto(file: File): Boolean {
        metadataFile(file).delete()
        return file.delete()
    }

    /** Burn GPS and capture time into the pixels, then write the same coordinates to EXIF. */
    private fun stampCoordinates(photo: File, latitude: Double, longitude: Double, accuracy: Float?, timestamp: Long): Boolean {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(photo.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return false
        val pixels = bounds.outWidth.toLong() * bounds.outHeight.toLong()
        // Never downsample and overwrite the original: that would silently destroy photo resolution.
        // Very large images keep their original pixels and still receive GPS EXIF + sidecar metadata.
        if (pixels > 18_000_000L) return false
        val options = BitmapFactory.Options().apply { inSampleSize = 1 }
        val decoded = BitmapFactory.decodeFile(photo.absolutePath, options) ?: return false
        val exif = runCatching { ExifInterface(photo.absolutePath) }.getOrNull()
        val orientation = exif?.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) ?: ExifInterface.ORIENTATION_NORMAL
        val rotation = when (orientation) { ExifInterface.ORIENTATION_ROTATE_90 -> 90f; ExifInterface.ORIENTATION_ROTATE_180 -> 180f; ExifInterface.ORIENTATION_ROTATE_270 -> 270f; else -> 0f }
        val bitmap = if (rotation != 0f) {
            val matrix = Matrix().apply { postRotate(rotation) }
            Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true).also { if (it !== decoded) decoded.recycle() }
        } else decoded
        val canvas = Canvas(bitmap)
        val scale = (bitmap.width / 1000f).coerceAtLeast(1f)
        val padding = 18f * scale
        val textSize = 27f * scale
        val lineGap = 10f * scale
        val accuracyText = accuracy?.takeIf { it.isFinite() && it >= 0f }?.let { " +/- %.1f m".format(Locale.US, it) } ?: ""
        val lines = listOf("GPS  %.6f, %.6f%s".format(Locale.US, latitude, longitude, accuracyText), SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date(timestamp)))
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; this.textSize = textSize; typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD); setShadowLayer(2f * scale, 1f * scale, 1f * scale, Color.BLACK) }
        val maxTextWidth = lines.maxOf { paint.measureText(it) }
        val boxHeight = padding * 2 + textSize * lines.size + lineGap
        val box = RectF(padding, bitmap.height - boxHeight - padding, minOf(bitmap.width - padding, maxTextWidth + padding * 2), bitmap.height - padding)
        canvas.drawRoundRect(box, 12f * scale, 12f * scale, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(190, 0, 0, 0) })
        var y = box.top + padding + textSize
        lines.forEach { line -> canvas.drawText(line, box.left + padding, y, paint); y += textSize + lineGap }
        val temp = File(photo.parentFile, photo.name + ".stamp.tmp")
        temp.outputStream().use { out -> if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 95, out)) throw IllegalStateException("JPEG stamp encoding failed") }
        bitmap.recycle()
        val backup = File(photo.parentFile, photo.name + ".stamp.bak")
        if (!photo.renameTo(backup)) { temp.delete(); throw IllegalStateException("Could not stage original photo") }
        if (!temp.renameTo(photo)) {
            backup.renameTo(photo)
            temp.delete()
            throw IllegalStateException("Could not replace stamped photo")
        }
        backup.delete()
        return true
    }
}
