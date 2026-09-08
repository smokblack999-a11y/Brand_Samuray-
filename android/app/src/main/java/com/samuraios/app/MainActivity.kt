package com.samuraios.app

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.Location
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.Gravity
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
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.concurrent.thread

class MainActivity : ComponentActivity() {
    private val coreUrl = BuildConfig.CORE_BASE_URL.trimEnd('/')
    private val permissionRequest = 100
    private lateinit var previewView: PreviewView
    private lateinit var statusText: TextView
    private lateinit var outputText: TextView
    private lateinit var chatIdInput: EditText
    private lateinit var messageInput: EditText
    private lateinit var galleryContainer: LinearLayout
    private var imageCapture: ImageCapture? = null
    private var selectedPhoto: File? = null
    private var pendingTimestamp: Long = 0L
    private var cameraExecutor: ExecutorService? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val locationClient by lazy { LocationServices.getFusedLocationProviderClient(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cameraExecutor = Executors.newSingleThreadExecutor()
        buildUi()
        if (hasPermissions()) startCamera() else ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), permissionRequest)
        refreshGallery()
        checkCoreStatus()
    }

    override fun onDestroy() { cameraExecutor?.shutdown(); super.onDestroy() }

    private fun hasPermissions(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED &&
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == permissionRequest && hasPermissions()) startCamera()
        else showToast("Для камеры и GPS нужны разрешения")
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 24, 24, 24); setBackgroundColor(Color.rgb(5, 8, 17)) }
        statusText = TextView(this).apply { text = "SamuraiOS: запуск..."; textSize = 20f; setTextColor(Color.rgb(0, 255, 136)); setPadding(0, 0, 0, 12) }
        root.addView(statusText)
        previewView = PreviewView(this).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
        root.addView(previewView, LinearLayout.LayoutParams(-1, 520))
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
                imageCapture = ImageCapture.Builder().setJpegQuality(85).build()
                provider.unbindAll()
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageCapture)
                statusText.text = "SamuraiOS: CAMERA ONLINE"
            } catch (e: Exception) { statusText.text = "Camera error: ${e.message}" }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun capturePhoto() {
        val capture = imageCapture ?: run { showToast("Камера ещё не готова"); return }
        val file = Vault.createPhotoFile(this)
        pendingTimestamp = System.currentTimeMillis()
        capture.takePicture(ImageCapture.OutputFileOptions.Builder(file).build(), cameraExecutor!!, object : ImageCapture.OnImageSavedCallback {
            override fun onError(exception: ImageCaptureException) { file.delete(); mainHandler.post { showToast("Ошибка камеры: ${exception.message}") } }
            override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) { fetchLocationAndSaveMetadata(file, pendingTimestamp) }
        })
    }

    private fun fetchLocationAndSaveMetadata(photo: File, timestamp: Long) {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED && ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            Vault.saveMetadata(photo, null, null, null, timestamp); mainHandler.post { refreshGallery(); showToast("Фото сохранено, GPS без разрешения") }; return
        }
        locationClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, CancellationTokenSource().token)
            .addOnSuccessListener { location: Location? ->
                Vault.saveMetadata(photo, location?.latitude, location?.longitude, location?.accuracy, timestamp)
                mainHandler.post { refreshGallery(); outputText.text = if (location != null) "Сохранено: %.6f, %.6f ± %.1fm".format(location.latitude, location.longitude, location.accuracy) else "Сохранено без GPS fix" }
            }
            .addOnFailureListener { Vault.saveMetadata(photo, null, null, null, timestamp); mainHandler.post { refreshGallery(); showToast("Фото сохранено, GPS недоступен") } }
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
            row.setOnClickListener { selectedPhoto = photo; outputText.text = "Выбрано: ${photo.name}" }
            galleryContainer.addView(row)
        }
    }

    private fun checkCoreStatus() = apiGet("/health") { result -> mainHandler.post { if (result.startsWith("ERROR:")) statusText.text = "Core: OFFLINE" else statusText.text = "Camera/Gallery + Core ONLINE"; outputText.text = result } }
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
        thread {
            var connection: HttpURLConnection? = null
            try {
                connection = (URL(coreUrl + path).openConnection() as HttpURLConnection).apply {
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
        thread {
            var connection: HttpURLConnection? = null
            try {
                connection = (URL(coreUrl + path).openConnection() as HttpURLConnection).apply {
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
