package com.samuraios.app

import android.content.Context
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
            ?.filter { it.isFile && it.extension.lowercase() == "jpg" }
            ?.sortedByDescending { it.lastModified() }
            ?: emptyList()
    }

    fun deletePhoto(file: File): Boolean {
        metadataFile(file).delete()
        return file.delete()
    }
}
