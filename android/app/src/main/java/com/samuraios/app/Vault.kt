package com.samuraios.app

import android.content.Context
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
        metadataFile(photo).writeText(json.toString())

        // Keep GPS in standard JPEG EXIF as well as in the app's sidecar JSON.
        // If no valid fix exists, do not fabricate coordinates.
        if (latitude != null && longitude != null &&
            latitude.isFinite() && longitude.isFinite() &&
            latitude in -90.0..90.0 && longitude in -180.0..180.0
        ) {
            runCatching {
                ExifInterface(photo.absolutePath).apply {
                    setLatLong(doubleArrayOf(latitude, longitude))
                    val formatted = SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.US).format(Date(timestamp))
                    setAttribute(ExifInterface.TAG_DATETIME, formatted)
                    setAttribute(ExifInterface.TAG_DATETIME_ORIGINAL, formatted)
                    saveAttributes()
                }
            }
        }
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
}
