package com.samuraios.app

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import java.util.UUID
import org.json.JSONObject

object Vault {

    private const val DIRECTORY = "photos"
    private val supportedExtensions = setOf("jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "avif", "bmp")

    fun directory(context: Context): File {
        return File(context.filesDir, DIRECTORY).apply {
            if (!exists() && !mkdirs() && !isDirectory) {
                throw IllegalStateException("Не удалось создать приватную галерею")
            }
        }
    }

    fun createPhotoFile(context: Context, extension: String = "jpg"): File {
        val safeExtension = extension.lowercase()
        require(safeExtension in supportedExtensions) { "Неподдерживаемый формат фото" }
        return File(directory(context), "samurai_${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(8)}.$safeExtension")
    }

    fun importPhoto(context: Context, uri: Uri): File {
        val extension = extensionFor(context, uri)
        val file = createPhotoFile(context, extension)
        try {
            context.contentResolver.openInputStream(uri).use { input ->
                requireNotNull(input) { "Не удалось открыть изображение" }
                file.outputStream().use { output -> input.copyTo(output) }
            }
            if (file.length() == 0L) throw IllegalArgumentException("Выбранное изображение пустое")
            return file
        } catch (error: Exception) {
            file.delete()
            throw error
        }
    }

    private fun extensionFor(context: Context, uri: Uri): String {
        val mime = context.contentResolver.getType(uri)?.lowercase()
        val fromMime = when (mime) {
            "image/jpeg", "image/jpg", "image/pjpeg" -> "jpg"
            "image/png" -> "png"
            "image/webp" -> "webp"
            "image/gif" -> "gif"
            "image/heic" -> "heic"
            "image/heif" -> "heif"
            "image/avif" -> "avif"
            "image/bmp", "image/x-ms-bmp" -> "bmp"
            else -> null
        }
        if (fromMime != null) return fromMime

        val displayName = context.contentResolver.query(
            uri,
            arrayOf(OpenableColumns.DISPLAY_NAME),
            null,
            null,
            null
        )?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }
        val fromName = displayName?.substringAfterLast('.', "")?.lowercase()
        return fromName?.takeIf { it in supportedExtensions }
            ?: throw IllegalArgumentException("Неподдерживаемый формат изображения")
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
    }

    fun metadata(photo: File): JSONObject? = runCatching {
        JSONObject(metadataFile(photo).readText())
    }.getOrNull()

    fun listPhotos(context: Context): List<File> {
        return directory(context).listFiles()
            ?.filter { it.isFile && it.extension.lowercase() in supportedExtensions }
            ?.sortedByDescending { it.lastModified() }
            ?: emptyList()
    }

    fun deletePhoto(file: File): Boolean {
        metadataFile(file).delete()
        return file.delete()
    }
}
