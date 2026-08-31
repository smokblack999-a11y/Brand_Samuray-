package com.samuraios.app

import android.content.Context
import java.io.File

object Vault {

    private const val DIRECTORY = "photos"

    fun directory(context: Context): File {
        return File(context.filesDir, DIRECTORY).apply {
            if (!exists()) {
                mkdirs()
            }
        }
    }

    fun createPhotoFile(context: Context): File {
        val timestamp = System.currentTimeMillis()
        return File(
            directory(context),
            "samurai_$timestamp.jpg"
        )
    }

    fun listPhotos(context: Context): List<File> {
        return directory(context)
            .listFiles()
            ?.filter { it.isFile && it.extension.lowercase() == "jpg" }
            ?.sortedByDescending { it.lastModified() }
            ?: emptyList()
    }

    fun deletePhoto(file: File): Boolean {
        return file.delete()
    }
}
