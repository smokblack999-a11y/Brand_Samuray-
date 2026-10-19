package com.samuraios.app

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.location.Location
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.system.Os
import android.text.InputType
import android.util.Base64
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.concurrent.thread

class MainActivity : ComponentActivity() {
    @Volatile private var coreUrl: String = ""
    private lateinit var coreUrlInput: EditText
    private val permissionRequest = 100
    private lateinit var previewView: PreviewView
    private lateinit var statusText: TextView
    private lateinit var outputText: TextView
    private lateinit var chatIdInput: EditText
    private lateinit var messageInput: EditText
    private lateinit var galleryContainer: LinearLayout
    private var imageCapture: ImageCapture? = null
    private var boundCamera: androidx.camera.core.Camera? = null
    private var selectedPhoto: File? = null
    private var cameraExecutor: ExecutorService? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val locationClient by lazy { LocationServices.getFusedLocationProviderClient(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cameraExecutor = Executors.newSingleThreadExecutor()
        val preferences = getSharedPreferences("samurai_settings", MODE_PRIVATE)
        val initialUrl = preferences.getString("core_base_url", null) ?: BuildConfig.CORE_BASE_URL
        coreUrl = validateCoreUrl(initialUrl) ?: ""
        buildUi()
        if (hasPermissions()) startCamera() else ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), permissionRequest)
        refreshGallery()
        checkCoreStatus()
    }

    override fun onDestroy() { cameraExecutor?.shutdown(); super.onDestroy() }

    private fun hasPermissions(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED &&
        (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED)

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == permissionRequest && hasPermissions()) startCamera()
        else showToast("Для камеры и GPS нужны разрешения")
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 24, 24, 24); setBackgroundColor(Color.rgb(5, 8, 17)) }
        statusText = TextView(this).apply { text = "SamuraiOS: запуск..."; textSize = 20f; setTextColor(Color.rgb(0, 255, 136)); setPadding(0, 0, 0, 12) }
        root.addView(statusText)
        root.addView(TextView(this).apply {
            text = "Адрес Core API"
            textSize = 16f
            setTextColor(Color.WHITE)
            setPadding(0, 4, 0, 4)
        })
        coreUrlInput = EditText(this).apply {
            hint = "https://ваш-сервер или http://127.0.0.1:8787"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            setText(coreUrl)
        }
        root.addView(coreUrlInput, LinearLayout.LayoutParams(-1, -2))
        root.addView(TextView(this).apply {
            text = "Удалённый сервер: только HTTPS. HTTP разрешён только для localhost, 127.0.0.1 или Android Emulator 10.0.2.2."
            textSize = 12f
            setTextColor(Color.LTGRAY)
        })
        root.addView(Button(this).apply {
            text = "СОХРАНИТЬ АДРЕС И ПРОВЕРИТЬ"
            setOnClickListener { saveCoreUrl() }
        })
        previewView = PreviewView(this).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
        val cameraFrame = FrameLayout(this)
        cameraFrame.addView(previewView, FrameLayout.LayoutParams(-1, -1))
        val zoomControls = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
            setPadding(8, 8, 8, 8)
            addView(Button(this@MainActivity).apply { text = "−"; contentDescription = "Уменьшить масштаб"; setOnClickListener { adjustZoom(0.8f) } })
            addView(Button(this@MainActivity).apply { text = "+"; contentDescription = "Увеличить масштаб"; setOnClickListener { adjustZoom(1.25f) } })
        }
        cameraFrame.addView(zoomControls, FrameLayout.LayoutParams(-2, -2, Gravity.END or Gravity.TOP))
        root.addView(cameraFrame, LinearLayout.LayoutParams(-1, 520))
        root.addView(Button(this).apply { text = "СНЯТЬ ФОТО + GPS"; setOnClickListener { capturePhoto() } })
        root.addView(TextView(this).apply { text = "Проектная галерея — приватное хранилище"; textSize = 18f; setTextColor(Color.WHITE); setPadding(0, 18, 0, 8) })
        galleryContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(galleryContainer)
        root.addView(TextView(this).apply { text = "Telegram"; textSize = 20f; setTextColor(Color.WHITE); setPadding(0, 24, 0, 8) })
        root.addView(Button(this).apply { text = "Мой Telegram"; setOnClickListener { loadMe() } })
        root.addView(Button(this).apply { text = "Диалоги"; setOnClickListener { loadDialogs() } })
        chatIdInput = EditText(this).apply { hint = "Chat ID, например -100..."; setSingleLine(true); setTextColor(Color.WHITE); setHintTextColor(Color.GRAY) }
        root.addView(chatIdInput, LinearLayout.LayoutParams(-1, -2))
        root.addView(Button(this).apply { text = "Загрузить сообщения"; setOnClickListener { loadMessages() } })
        messageInput = EditText(this).apply { hint = "Сообщение..."; setTextColor(Color.WHITE); setHintTextColor(Color.GRAY); minLines = 3; gravity = Gravity.TOP }
        root.addView(messageInput, LinearLayout.LayoutParams(-1, -2))
        root.addView(Button(this).apply { text = "ОТПРАВИТЬ СООБЩЕНИЕ"; setOnClickListener { sendTelegramMessage() } })
        root.addView(Button(this).apply { text = "ОТПРАВИТЬ ВЫБРАННОЕ ФОТО"; setOnClickListener { sendSelectedPhoto() } })
        outputText = TextView(this).apply { text = "Выберите фото в галерее, затем отправьте его в Telegram."; textSize = 14f; setTextColor(Color.LTGRAY); setPadding(0, 18, 0, 18) }
        root.addView(outputText)
        setContentView(ScrollView(this).apply { addView(root) })
    }

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            try {
                val provider = future.get()
                val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
                imageCapture = ImageCapture.Builder().setJpegQuality(95).build()
                provider.unbindAll()
                boundCamera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageCapture)
                statusText.text = "Камера готова · JPEG 95%"
            } catch (e: Exception) { statusText.text = "Ошибка камеры: " + e.javaClass.simpleName + ": " + (e.message ?: "без подробностей") }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun adjustZoom(factor: Float) {
        val camera = boundCamera ?: run { showToast("Камера ещё не готова"); return }
        val state = camera.cameraInfo.zoomState.value ?: return
        val target = (state.zoomRatio * factor).coerceIn(state.minZoomRatio, state.maxZoomRatio)
        camera.cameraControl.setZoomRatio(target)
    }

    private fun capturePhoto() {
        val capture = imageCapture ?: run { showToast("Камера ещё не готова"); return }
        val executor = cameraExecutor ?: run { showToast("Камера занята"); return }
        val file = Vault.createPhotoFile(this)
        val timestamp = System.currentTimeMillis()
        capture.takePicture(ImageCapture.OutputFileOptions.Builder(file).build(), executor, object : ImageCapture.OnImageSavedCallback {
            override fun onError(exception: ImageCaptureException) {
                file.delete()
                mainHandler.post { showToast("Ошибка камеры: " + (exception.message ?: exception.javaClass.simpleName)) }
            }
            override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                fetchLocationAndSaveMetadata(file, timestamp)
            }
        })
    }

    private fun fetchLocationAndSaveMetadata(photo: File, timestamp: Long) {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED && ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            finalizePhoto(photo, null, timestamp, "Фото сохранено, GPS без разрешения"); return
        }
        locationClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, CancellationTokenSource().token)
            .addOnSuccessListener { location: Location? ->
                finalizePhoto(photo, location, timestamp, if (location == null) "Фото сохранено без GPS fix" else null)
            }
            .addOnFailureListener { finalizePhoto(photo, null, timestamp, "Фото сохранено, GPS недоступен") }
    }

    private fun refreshGallery() {
        galleryContainer.removeAllViews()
        val photos = Vault.listPhotos(this)
        if (photos.isEmpty()) { galleryContainer.addView(TextView(this).apply { text = "Пока нет фото"; setTextColor(Color.GRAY) }); return }
        photos.forEach { photo ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, 6, 0, 6) }
            val image = ImageView(this).apply { setImageURI(android.net.Uri.fromFile(photo)); scaleType = ImageView.ScaleType.CENTER_CROP }
            row.addView(image, LinearLayout.LayoutParams(180, 130))
            val meta = Vault.metadata(photo)
            val text = TextView(this).apply { text = if (meta?.has("latitude") == true && !meta.isNull("latitude")) "${photo.name}\nGPS: ${meta.optDouble("latitude")}, ${meta.optDouble("longitude")}\n± ${meta.optDouble("accuracyMeters", 0.0)} m" else photo.name + "\nGPS: нет fix"; setTextColor(Color.LTGRAY); setPadding(12, 0, 0, 0) }
            row.addView(text, LinearLayout.LayoutParams(0, -2, 1f))
            row.setOnClickListener { selectedPhoto = photo; outputText.text = "Выбрано: " + photo.name; openPhotoViewer(photo) }
            galleryContainer.addView(row)
        }
    }


    private fun finalizePhoto(photo: File, location: Location?, timestamp: Long, noGpsMessage: String? = null) {
        val executor = cameraExecutor
        if (executor == null) {
            Vault.saveMetadata(photo, location?.latitude, location?.longitude, location?.accuracy, timestamp)
            mainHandler.post { refreshGallery(); showToast(noGpsMessage ?: "Фото сохранено") }
            return
        }
        executor.execute {
            val stamped = stampPhoto(photo, location, timestamp)
            Vault.saveMetadata(photo, location?.latitude, location?.longitude, location?.accuracy, timestamp)
            mainHandler.post {
                refreshGallery()
                outputText.text = if (location != null) {
                    "Фото сохранено · GPS " + String.format(Locale.US, "%.6f, %.6f ± %.1f м", location.latitude, location.longitude, location.accuracy) +
                        " · отметка " + if (stamped) "на фото" else "не нанесена"
                } else {
                    "Фото сохранено · GPS недоступен · отметка " + if (stamped) "на фото" else "не нанесена"
                }
                if (noGpsMessage != null) showToast(noGpsMessage)
            }
        }
    }

    private fun stampPhoto(photo: File, location: Location?, timestamp: Long): Boolean {
        var bitmap: Bitmap? = null
        val temp = File(photo.parentFile, photo.nameWithoutExtension + ".stamped.tmp")
        return try {
            val decoded = BitmapFactory.decodeFile(photo.absolutePath) ?: return false
            bitmap = decoded
            val canvas = Canvas(decoded)
            val width = decoded.width.toFloat()
            val height = decoded.height.toFloat()
            val margin = (width * 0.025f).coerceAtLeast(12f)
            val textSize = (width * 0.026f).coerceIn(22f, 64f)
            val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.WHITE
                setTextSize(textSize)
                typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
            }
            val detailPaint = Paint(titlePaint).apply {
                setTextSize(textSize * 0.78f)
                typeface = Typeface.create("sans-serif", Typeface.NORMAL)
            }
            val time = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date(timestamp))
            val firstLine = "SAMURAIOS  |  " + time
            val secondLine = if (location != null) {
                "GPS " + String.format(Locale.US, "%.6f, %.6f  ± %.1f m", location.latitude, location.longitude, location.accuracy)
            } else {
                "GPS unavailable"
            }
            val lineHeight = textSize * 1.25f
            val boxHeight = margin * 2 + lineHeight * 2
            val top = (height - boxHeight).coerceAtLeast(0f)
            canvas.drawRect(RectF(0f, top, width, height), Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(190, 0, 0, 0) })
            canvas.drawText(firstLine, margin, top + margin + textSize, titlePaint)
            canvas.drawText(secondLine, margin, top + margin + textSize + lineHeight, detailPaint)
            FileOutputStream(temp).use { stream ->
                if (!decoded.compress(Bitmap.CompressFormat.JPEG, 95, stream)) return false
                stream.fd.sync()
            }
            // Atomic same-directory rename: if stamping fails, the original JPEG stays intact.
            Os.rename(temp.absolutePath, photo.absolutePath)
            true
        } catch (_: OutOfMemoryError) {
            false
        } catch (_: Exception) {
            false
        } finally {
            bitmap?.recycle()
            temp.delete()
        }
    }

    private fun openPhotoViewer(photo: File) {
        val dialog = android.app.Dialog(this)
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16, 16, 16, 16)
            setBackgroundColor(Color.BLACK)
        }
        val image = ImageView(this).apply {
            setImageURI(android.net.Uri.fromFile(photo))
            scaleType = ImageView.ScaleType.FIT_CENTER
            adjustViewBounds = true
            contentDescription = "Фото " + photo.name
        }
        content.addView(image, LinearLayout.LayoutParams(-1, 0, 1f))
        val metadata = Vault.metadata(photo)
        val lat = metadata?.optDouble("latitude", Double.NaN) ?: Double.NaN
        val lon = metadata?.optDouble("longitude", Double.NaN) ?: Double.NaN
        val details = TextView(this).apply {
            text = if (lat.isFinite() && lon.isFinite()) {
                photo.name + "\nGPS " + String.format(Locale.US, "%.6f, %.6f", lat, lon)
            } else {
                photo.name + "\nGPS недоступен"
            }
            setTextColor(Color.WHITE)
            setPadding(0, 12, 0, 12)
        }
        content.addView(details)
        content.addView(Button(this).apply { text = "ЗАКРЫТЬ"; setOnClickListener { dialog.dismiss() } })
        dialog.setContentView(content)
        dialog.show()
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    }

    private fun checkCoreStatus() {
        if (coreUrl.isBlank()) {
            outputText.text = "Core не настроен. Укажи HTTPS-адрес сервера или локальный http://127.0.0.1:8787 и нажми «СОХРАНИТЬ АДРЕС И ПРОВЕРИТЬ»."
            return
        }
        apiGet("/health") { result ->
            mainHandler.post {
                outputText.text = if (result.startsWith("ERROR:")) "Core OFFLINE\n" + result else "Core ONLINE\n" + result
            }
        }
    }

    private fun saveCoreUrl() {
        val validated = validateCoreUrl(coreUrlInput.text.toString())
        if (validated == null) {
            showToast("URL недопустим: нужен HTTPS; HTTP только localhost/127.0.0.1/10.0.2.2")
            return
        }
        coreUrl = validated
        getSharedPreferences("samurai_settings", MODE_PRIVATE)
            .edit()
            .putString("core_base_url", validated)
            .apply()
        outputText.text = "Проверяю Core: $validated"
        checkCoreStatus()
    }

    private fun validateCoreUrl(raw: String): String? {
        val value = raw.trim().trimEnd('/')
        if (value.isBlank()) return null
        val uri = try { URI(value) } catch (_: Exception) { return null }
        val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
        val host = uri.host?.lowercase(Locale.ROOT) ?: return null
        if (scheme != "https" && scheme != "http") return null
        if (uri.rawUserInfo != null || uri.rawQuery != null || uri.rawFragment != null) return null
        if (uri.port == 0 || uri.port > 65535) return null
        if (host == "core.example.invalid" || host.endsWith(".example.invalid")) return null
        if (scheme == "http" && host !in setOf("localhost", "127.0.0.1", "::1", "10.0.2.2")) return null
        return value
    }
    private fun loadMe() = apiGet("/api/telegram/me") { result -> mainHandler.post { outputText.text = result } }
    private fun loadDialogs() = apiGet("/api/telegram/dialogs?limit=20") { result -> mainHandler.post { outputText.text = result } }

    private fun loadMessages() {
        val chatId = chatIdInput.text.toString().trim()
        if (chatId.isEmpty()) { showToast("Введите Chat ID"); return }
        apiGet("/api/telegram/messages?chatId=${encodeUrl(chatId)}&limit=30") { result -> mainHandler.post { outputText.text = result } }
    }

    private fun sendTelegramMessage() {
        val chatId = chatIdInput.text.toString().trim(); val message = messageInput.text.toString().trim()
        if (chatId.isEmpty() || message.isEmpty()) { showToast("Нужны Chat ID и сообщение"); return }
        apiPost("/api/telegram/send", "{\"chatId\":\"${jsonEscape(chatId)}\",\"message\":\"${jsonEscape(message)}\"}") { result -> mainHandler.post { outputText.text = result; if (!result.startsWith("ERROR:")) messageInput.setText("") } }
    }

    private fun sendSelectedPhoto() {
        val photo = selectedPhoto ?: run { showToast("Сначала выберите фото"); return }
        val chatId = chatIdInput.text.toString().trim(); if (chatId.isEmpty()) { showToast("Введите Chat ID"); return }
        outputText.text = "Подготовка фото..."
        thread {
            try {
                val bytes = photo.readBytes(); val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP); val meta = Vault.metadata(photo)
                val caption = if (meta != null) "SamuraiOS | ${meta.optDouble("latitude", Double.NaN)}, ${meta.optDouble("longitude", Double.NaN)} | ±${meta.optDouble("accuracyMeters", 0.0)}m" else "SamuraiOS | ${photo.name}"
                val json = "{\"chatId\":\"${jsonEscape(chatId)}\",\"fileName\":\"${jsonEscape(photo.name)}\",\"caption\":\"${jsonEscape(caption)}\",\"base64\":\"$base64\"}"
                apiPost("/api/telegram/send-photo", json) { result -> mainHandler.post { outputText.text = result } }
            } catch (e: Exception) { mainHandler.post { outputText.text = "ERROR: ${e.javaClass.simpleName}: ${e.message}" } }
        }
    }

    private fun apiGet(path: String, callback: (String) -> Unit) {
        val baseUrl = coreUrl
        if (baseUrl.isBlank()) {
            callback("ERROR: Core не настроен. Сначала укажи адрес сервера.")
            return
        }
        thread {
            var connection: HttpURLConnection? = null
            try {
                connection = (URL(baseUrl + path).openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"; connectTimeout = 5000; readTimeout = 10000; useCaches = false
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("X-Request-ID", UUID.randomUUID().toString())
                }
                val code = connection.responseCode; val stream = if (code in 200..299) connection.inputStream else connection.errorStream; val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
                callback(if (code in 200..299) body else "ERROR: HTTP $code\n$body")
            } catch (e: Exception) { callback("ERROR: ${e.javaClass.simpleName}: ${e.message}") } finally { connection?.disconnect() }
        }
    }

    private fun apiPost(path: String, json: String, callback: (String) -> Unit) {
        val baseUrl = coreUrl
        if (baseUrl.isBlank()) {
            callback("ERROR: Core не настроен. Сначала укажи адрес сервера.")
            return
        }
        thread {
            var connection: HttpURLConnection? = null
            try {
                connection = (URL(baseUrl + path).openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"; connectTimeout = 5000; readTimeout = 30000; useCaches = false; doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=UTF-8"); setRequestProperty("Accept", "application/json")
                    setRequestProperty("X-Request-ID", UUID.randomUUID().toString())
                }
                connection.outputStream.use { output: OutputStream -> output.write(json.toByteArray(Charsets.UTF_8)); output.flush() }
                val code = connection.responseCode; val stream = if (code in 200..299) connection.inputStream else connection.errorStream; val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
                callback(if (code in 200..299) body else "ERROR: HTTP $code\n$body")
            } catch (e: Exception) { callback("ERROR: ${e.javaClass.simpleName}: ${e.message}") } finally { connection?.disconnect() }
        }
    }

    private fun jsonEscape(value: String): String = value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
    private fun encodeUrl(value: String): String = URLEncoder.encode(value, "UTF-8")
    private fun showToast(message: String) = mainHandler.post { Toast.makeText(this, message, Toast.LENGTH_SHORT).show() }
}
