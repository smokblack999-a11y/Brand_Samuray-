package com.samuraios.app

import android.content.Context
import java.io.File
import java.security.MessageDigest
import org.json.JSONObject

object Vault {
    private const val DIRECTORY = "gallery"
    private const val PREFS = "samurai_camera_settings"
    private const val GPS = "gps_enabled"
    private const val TIME = "time_enabled"
    private const val AUTH = "auth_enabled"
    private const val SHA = "sha256_enabled"

    fun directory(context: Context): File = File(context.filesDir, DIRECTORY).apply { if (!exists()) mkdirs() }

    fun createPhotoFile(context: Context): File = File(directory(context), "samurai_${java.util.UUID.randomUUID()}.jpg")
    fun createVideoFile(context: Context): File = File(directory(context), "samurai_${java.util.UUID.randomUUID()}.mp4")
    fun metadataFile(media: File): File = File(media.parentFile, "${media.nameWithoutExtension}.json")

    fun saveMetadata(
        media: File,
        latitude: Double?,
        longitude: Double?,
        accuracy: Float?,
        timestamp: Long,
        includeGps: Boolean,
        includeTime: Boolean,
        includeAuthenticity: Boolean,
        includeSha256: Boolean
    ) {
        val json = JSONObject().apply {
            put("version", 2)
            put("type", if (media.extension.equals("mp4", true)) "VIDEO" else "PHOTO")
            put("fileName", media.name)
            if (includeTime) put("timestamp", timestamp)
            if (includeGps && latitude != null && longitude != null) {
                put("latitude", latitude)
                put("longitude", longitude)
                if (accuracy != null) put("accuracyMeters", accuracy)
            }
            if (includeAuthenticity) {
                put("authenticity", "SHA-256")
                if (includeSha256) put("sha256", sha256(media))
            }
        }
        metadataFile(media).writeText(json.toString())
    }

    fun metadata(media: File): JSONObject? = runCatching { JSONObject(metadataFile(media).readText()) }.getOrNull()

    fun listMedia(context: Context): List<File> = directory(context).listFiles()
        ?.filter { it.isFile && (it.extension.equals("jpg", true) || it.extension.equals("mp4", true)) }
        ?.sortedByDescending { it.lastModified() }
        ?: emptyList()

    fun listPhotos(context: Context): List<File> = listMedia(context).filter { it.extension.equals("jpg", true) }
    fun listVideos(context: Context): List<File> = listMedia(context).filter { it.extension.equals("mp4", true) }

    fun deleteMedia(file: File): Boolean {
        metadataFile(file).delete()
        return file.delete()
    }

    fun deletePhoto(file: File): Boolean = deleteMedia(file)

    fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(8192)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    fun isGpsEnabled(context: Context) = prefs(context).getBoolean(GPS, true)
    fun isTimeEnabled(context: Context) = prefs(context).getBoolean(TIME, true)
    fun isAuthEnabled(context: Context) = prefs(context).getBoolean(AUTH, false)
    fun isSha256Enabled(context: Context) = prefs(context).getBoolean(SHA, true)

    fun setGpsEnabled(context: Context, value: Boolean) = prefs(context).edit().putBoolean(GPS, value).apply()
    fun setTimeEnabled(context: Context, value: Boolean) = prefs(context).edit().putBoolean(TIME, value).apply()
    fun setAuthEnabled(context: Context, value: Boolean) = prefs(context).edit().putBoolean(AUTH, value).apply()
    fun setSha256Enabled(context: Context, value: Boolean) = prefs(context).edit().putBoolean(SHA, value).apply()

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
