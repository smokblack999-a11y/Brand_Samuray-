package com.samurai.whatsapp

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import java.util.Locale

internal data class CachedStatusFile(
    val documentId: String,
    val uri: Uri,
    val displayName: String,
    val mimeType: String,
    val sizeBytes: Long,
    val modifiedAt: Long
)

/**
 * Reads only a folder explicitly selected by the user through Android's Storage Access Framework.
 * The selected folder should be WhatsApp/Media or its .Statuses directory.
 */
internal object StatusSaver {
    private const val PREFS = "samurai_status_saver"
    private const val TREE_URI_KEY = "selected_status_tree_uri"
    private const val MAX_RESULTS = 300
    private const val MAX_SEARCH_DEPTH = 4
    private const val MAX_SEARCH_DIRECTORIES = 500
    private val projection = arrayOf(
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_SIZE,
        DocumentsContract.Document.COLUMN_LAST_MODIFIED
    )

    fun createPickerIntent(): Intent =
        Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            )
        }

    fun setSelectedTree(context: Context, treeUri: Uri, grantFlags: Int) {
        val takeFlags = grantFlags and
            (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        context.contentResolver.takePersistableUriPermission(treeUri, takeFlags)
        val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(TREE_URI_KEY, treeUri.toString())
            .commit()
        check(saved) { "Could not save the selected Status folder" }
    }

    fun selectedTree(context: Context): Uri? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(TREE_URI_KEY, null)
            ?.let(Uri::parse)

    fun clearSelectedTree(context: Context) {
        val oldUri = selectedTree(context)
        if (oldUri != null) {
            runCatching {
                context.contentResolver.releasePersistableUriPermission(
                    oldUri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                )
            }
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(TREE_URI_KEY)
            .commit()
    }

    fun list(context: Context): List<CachedStatusFile> {
        val treeUri = selectedTree(context)
            ?: return emptyList()
        val rootDocumentId = DocumentsContract.getTreeDocumentId(treeUri)
        val rootName = queryDocumentName(context, treeUri, rootDocumentId)
        val statusDocumentId = if (isStatusesFolder(rootName)) {
            rootDocumentId
        } else {
            findStatusesFolder(context, treeUri, rootDocumentId)
                ?: throw IllegalStateException(
                    "Папка .Statuses не найдена среди доступных каталогов. Выбери WhatsApp/Media или саму .Statuses. Если Android не показывает скрытую папку, этот SAF-провайдер не предоставляет к ней доступ."
                )
        }

        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
            treeUri,
            statusDocumentId
        )
        val items = ArrayList<CachedStatusFile>()
        context.contentResolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
            val idColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
            val nameColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
            val mimeColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
            val sizeColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE)
            val modifiedColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED)

            while (cursor.moveToNext() && items.size < MAX_RESULTS) {
                if (idColumn < 0 || nameColumn < 0 || mimeColumn < 0) break
                val documentId = cursor.getString(idColumn) ?: continue
                val name = cursor.getString(nameColumn) ?: continue
                if (name.startsWith(".") || name.equals(".nomedia", true)) continue

                val providerMime = cursor.getString(mimeColumn).orEmpty()
                if (providerMime == DocumentsContract.Document.MIME_TYPE_DIR) continue
                val mimeType = normalizeMimeType(providerMime, name)
                if (!isSupportedStatusMime(mimeType, name)) continue

                val size = if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) {
                    cursor.getLong(sizeColumn).coerceAtLeast(0L)
                } else 0L
                val modified = if (modifiedColumn >= 0 && !cursor.isNull(modifiedColumn)) {
                    cursor.getLong(modifiedColumn).coerceAtLeast(0L)
                } else 0L

                items.add(
                    CachedStatusFile(
                        documentId = documentId,
                        uri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId),
                        displayName = name.take(180),
                        mimeType = mimeType,
                        sizeBytes = size,
                        modifiedAt = modified
                    )
                )
            }
        } ?: throw IllegalStateException("Android не смог прочитать выбранную папку статусов")

        return items.sortedByDescending { it.modifiedAt }
    }

    fun saveToVault(context: Context, item: CachedStatusFile): MediaVaultItem =
        MediaVault.importFromUri(context, item.uri, item.mimeType)

    internal fun isStatusesFolder(name: String): Boolean {
        val normalized = name.trim().lowercase(Locale.ROOT)
        return normalized == ".statuses" || normalized == "statuses"
    }

    internal fun normalizeMimeType(providerMime: String, name: String): String {
        if (providerMime.startsWith("image/") || providerMime.startsWith("video/")) {
            return providerMime
        }
        return when (name.substringAfterLast('.', "").lowercase(Locale.ROOT)) {
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "mp4" -> "video/mp4"
            "3gp" -> "video/3gpp"
            "mkv" -> "video/x-matroska"
            "mov" -> "video/quicktime"
            else -> providerMime.ifBlank { "application/octet-stream" }
        }
    }

    private fun isSupportedStatusMime(mimeType: String, name: String): Boolean {
        val extension = name.substringAfterLast('.', "").lowercase(Locale.ROOT)
        val knownExtension = extension in setOf(
            "jpg", "jpeg", "png", "webp", "gif", "mp4", "3gp", "mkv", "mov"
        )
        return mimeType.startsWith("image/") || mimeType.startsWith("video/") || knownExtension
    }

    private fun queryDocumentName(context: Context, treeUri: Uri, documentId: String): String {
        val documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)
        context.contentResolver.query(
            documentUri,
            arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
            null,
            null,
            null
        )?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
                if (index >= 0) return cursor.getString(index).orEmpty()
            }
        }
        return documentId.substringAfterLast('/')
    }

    private fun findStatusesFolder(
        context: Context,
        treeUri: Uri,
        parentDocumentId: String
    ): String? {
        // SAF providers may expose intermediate directories. Search a bounded
        // tree instead of assuming .Statuses is an immediate child.
        data class PendingFolder(val documentId: String, val depth: Int)
        val pending = ArrayDeque<PendingFolder>()
        val visited = HashSet<String>()
        pending.add(PendingFolder(parentDocumentId, 0))
        visited.add(parentDocumentId)
        var examinedDirectories = 0

        while (pending.isNotEmpty() && examinedDirectories < MAX_SEARCH_DIRECTORIES) {
            val current = pending.removeFirst()
            if (current.depth >= MAX_SEARCH_DEPTH) continue
            val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
                treeUri,
                current.documentId
            )
            context.contentResolver.query(
                childrenUri,
                arrayOf(
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE
                ),
                null,
                null,
                null
            )?.use { cursor ->
                val idColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
                val nameColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
                val mimeColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
                if (idColumn < 0 || nameColumn < 0 || mimeColumn < 0) continue

                while (cursor.moveToNext()) {
                    val documentId = cursor.getString(idColumn) ?: continue
                    val name = cursor.getString(nameColumn).orEmpty()
                    val mime = cursor.getString(mimeColumn).orEmpty()
                    if (mime != DocumentsContract.Document.MIME_TYPE_DIR) continue
                    if (isStatusesFolder(name)) return documentId
                    if (visited.add(documentId)) {
                        pending.add(PendingFolder(documentId, current.depth + 1))
                        examinedDirectories += 1
                        if (examinedDirectories >= MAX_SEARCH_DIRECTORIES) break
                    }
                }
            }
        }
        return null
    }
}
