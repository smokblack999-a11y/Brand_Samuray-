package com.samuraios.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.Gravity
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import org.json.JSONObject
import java.io.File
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
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
    private lateinit var galleryContainer: LinearLayout
    private lateinit var gpsSwitch: Switch
    private lateinit var timeSwitch: Switch
    private lateinit var authSwitch: Switch
    private lateinit var shaSwitch: Switch
    private lateinit var photoButton: Button
    private lateinit var videoButton: Button
    private var imageCapture: ImageCapture? = null
    private var videoCapture: VideoCapture<Recorder>? = null
    private var recording: Recording? = null
    private var selectedMedia: File? = null
    private var cameraExecutor: ExecutorService? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val locationClient by lazy { LocationServices.getFusedLocationProviderClient(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cameraExecutor = Executors.newSingleThreadExecutor()
        buildUi()
        requestMissingPermissions()
        refreshGallery()
        checkCoreStatus()
    }

    override fun onDestroy() { recording?.stop(); cameraExecutor?.shutdown(); super.onDestroy() }

    private fun requestMissingPermissions() {
        val requested = mutableListOf(Manifest.permission.CAMERA)
        if (Vault.isGpsEnabled(this)) {
            requested += Manifest.permission.ACCESS_FINE_LOCATION
            requested += Manifest.permission.ACCESS_COARSE_LOCATION
        }
        val missing = requested.distinct().filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) startCamera() else ActivityCompat.requestPermissions(this, missing.toTypedArray(), permissionRequest)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == permissionRequest) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) startCamera()
            else showToast("Без разрешения камеры съёмка недоступна")
            refreshGallery()
        }
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(20, 20, 20, 28); setBackgroundColor(Color.rgb(5, 8, 17)) }
        statusText = TextView(this).apply { text = "SAMURAI CAMERA · STARTING"; textSize = 18f; setTextColor(Color.rgb(0, 255, 136)); setPadding(0, 0, 0, 12) }
        root.addView(statusText)
        previewView = PreviewView(this).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
        root.addView(previewView, LinearLayout.LayoutParams(-1, 520))
        root.addView(TextView(this).apply { text = "СЪЁМКА · МЕТАДАННЫЕ"; textSize = 18f; setTextColor(Color.WHITE); setPadding(0, 14, 0, 4) })
        gpsSwitch = settingSwitch("📍 Координаты GPS", Vault.isGpsEnabled(this)) { enabled ->
            Vault.setGpsEnabled(this, enabled)
            if (enabled && ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), permissionRequest)
            updateModeText()
        }
        timeSwitch = settingSwitch("🕒 Время съёмки", Vault.isTimeEnabled(this)) { enabled -> Vault.setTimeEnabled(this, enabled); updateModeText() }
        authSwitch = settingSwitch("🛡 Защита подлинности", Vault.isAuthEnabled(this)) { enabled -> Vault.setAuthEnabled(this, enabled); updateModeText() }
        shaSwitch = settingSwitch("🔐 SHA-256 отпечаток", Vault.isSha256Enabled(this)) { enabled -> Vault.setSha256Enabled(this, enabled); updateModeText() }
        root.addView(gpsSwitch); root.addView(timeSwitch); root.addView(authSwitch); root.addView(shaSwitch)
        photoButton = Button(this).apply { text = "📷 СНЯТЬ ФОТО"; setOnClickListener { capturePhoto() } }
        videoButton = Button(this).apply { text = "🎥 НАЧАТЬ ВИДЕО"; setOnClickListener { toggleVideo() } }
        root.addView(photoButton); root.addView(videoButton)
        root.addView(Button(this).apply { text = "ОБНОВИТЬ ГАЛЕРЕЮ"; setOnClickListener { refreshGallery() } })
        root.addView(TextView(this).apply { text = "SAMURAI GALLERY · PHOTO + VIDEO"; textSize = 18f; setTextColor(Color.WHITE); setPadding(0, 20, 0, 8) })
        galleryContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(galleryContainer)
        root.addView(TextView(this).apply { text = "Telegram Chat ID"; setTextColor(Color.LTGRAY); setPadding(0, 18, 0, 4) })
        chatIdInput = EditText(this).apply { hint = "например -1001234567890"; setSingleLine(true); setTextColor(Color.WHITE); setHintTextColor(Color.GRAY) }
        root.addView(chatIdInput)
        root.addView(Button(this).apply { text = "ПРОВЕРИТЬ TELEGRAM"; setOnClickListener { loadMe() } })
        root.addView(Button(this).apply { text = "ОТПРАВИТЬ ВЫБРАННОЕ"; setOnClickListener { shareSelectedMedia() } })
        root.addView(Button(this).apply { text = "ОТПРАВИТЬ ФОТО ЧЕРЕЗ CORE"; setOnClickListener { sendSelectedPhoto() } })
        root.addView(Button(this).apply { text = "ОТПРАВИТЬ GPS"; setOnClickListener { sendSelectedLocation() } })
        outputText = TextView(this).apply { textSize = 14f; setTextColor(Color.LTGRAY); setPadding(0, 18, 0, 18) }
        root.addView(outputText)
        setContentView(ScrollView(this).apply { addView(root) })
        updateModeText()
    }

    private fun settingSwitch(label: String, initial: Boolean, onChange: (Boolean) -> Unit): Switch = Switch(this).apply {
        text = label; isChecked = initial; textSize = 15f; setTextColor(Color.LTGRAY); setPadding(0, 4, 0, 4)
        setOnCheckedChangeListener { _, checked -> onChange(checked) }
    }

    private fun updateModeText() {
        statusText.text = "SAMURAI CAMERA · " + listOf(
            if (Vault.isGpsEnabled(this)) "GPS ON" else "GPS OFF",
            if (Vault.isTimeEnabled(this)) "TIME ON" else "TIME OFF",
            if (Vault.isAuthEnabled(this)) "AUTH ON" else "AUTH OFF",
            if (Vault.isSha256Enabled(this)) "SHA ON" else "SHA OFF"
        ).joinToString(" · ")
    }

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            try {
                val provider = future.get()
                val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
                imageCapture = ImageCapture.Builder().setJpegQuality(88).build()
                val recorder = Recorder.Builder().setQualitySelector(QualitySelector.fromOrderedList(listOf(Quality.FHD, Quality.HD, Quality.SD))).build()
                videoCapture = VideoCapture.withOutput(recorder)
                provider.unbindAll()
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageCapture, videoCapture)
                updateModeText()
            } catch (e: Exception) { statusText.text = "CAMERA ERROR: ${e.message}" }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun capturePhoto() {
        val capture = imageCapture ?: run { showToast("Камера ещё не готова"); return }
        val file = Vault.createPhotoFile(this)
        val timestamp = System.currentTimeMillis()
        capture.takePicture(ImageCapture.OutputFileOptions.Builder(file).build(), cameraExecutor!!, object : ImageCapture.OnImageSavedCallback {
            override fun onError(exception: ImageCaptureException) { file.delete(); showToast("Ошибка фото: ${exception.message}") }
            override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) { finalizeMedia(file, timestamp) }
        })
    }

    private fun toggleVideo() {
        recording?.let { it.stop(); videoButton.isEnabled = false; videoButton.text = "🎥 СОХРАНЕНИЕ..."; return }
        val capture = videoCapture ?: run { showToast("Видео ещё не готово"); return }
        val file = Vault.createVideoFile(this)
        try {
            recording = capture.output.prepareRecording(this, FileOutputOptions.Builder(file).build()).start(ContextCompat.getMainExecutor(this)) { event ->
                when (event) {
                    is VideoRecordEvent.Start -> { videoButton.text = "⏹ ОСТАНОВИТЬ ВИДЕО"; outputText.text = "Видео записывается в SAMURAI GALLERY..." }
                    is VideoRecordEvent.Finalize -> {
                        recording = null; videoButton.isEnabled = true; videoButton.text = "🎥 НАЧАТЬ ВИДЕО"
                        if (!event.hasError()) finalizeMedia(file, System.currentTimeMillis()) else { file.delete(); outputText.text = "Ошибка видео: ${event.error}" }
                    }
                }
            }
        } catch (e: Exception) { recording = null; file.delete(); showToast("Ошибка запуска видео: ${e.message}") }
    }

    private fun finalizeMedia(media: File, timestamp: Long) { if (Vault.isGpsEnabled(this)) saveLocation(media, timestamp) else saveWithoutLocation(media, timestamp) }

    private fun saveWithoutLocation(media: File, timestamp: Long) {
        Vault.saveMetadata(media, null, null, null, timestamp, false, Vault.isTimeEnabled(this), Vault.isAuthEnabled(this), Vault.isSha256Enabled(this))
        mainHandler.post { refreshGallery(); outputText.text = "Сохранено в SAMURAI GALLERY · GPS OFF" }
    }

    private fun saveLocation(media: File, timestamp: Long) {
        val fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!fine && !coarse) { saveWithoutLocation(media, timestamp); return }
        locationClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, CancellationTokenSource().token).addOnSuccessListener { location ->
            Vault.saveMetadata(media, location?.latitude, location?.longitude, location?.accuracy, timestamp, location != null, Vault.isTimeEnabled(this), Vault.isAuthEnabled(this), Vault.isSha256Enabled(this))
            mainHandler.post { refreshGallery(); outputText.text = if (location != null) "Сохранено · %.6f, %.6f · ±%.1f м".format(location.latitude, location.longitude, location.accuracy) else "Сохранено без GPS fix" }
        }.addOnFailureListener { saveWithoutLocation(media, timestamp) }
    }

    private fun refreshGallery() {
        galleryContainer.removeAllViews()
        val mediaFiles = Vault.listMedia(this)
        if (mediaFiles.isEmpty()) { galleryContainer.addView(TextView(this).apply { text = "Пока нет фото или видео"; setTextColor(Color.GRAY); setPadding(0, 8, 0, 8) }); return }
        mediaFiles.forEach { media ->
            val meta = Vault.metadata(media); val isVideo = media.extension.equals("mp4", true)
            val row = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, 8, 0, 8) }
            val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            val preview = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP; if (isVideo) setImageBitmap(videoThumbnail(media)) else setImageURI(Uri.fromFile(media)); setOnClickListener { openMedia(media) } }
            top.addView(preview, LinearLayout.LayoutParams(180, 130))
            val hasGps = meta?.has("latitude") == true && meta.has("longitude") && !meta.isNull("latitude") && !meta.isNull("longitude")
            val details = TextView(this).apply {
                text = buildString {
                    append(if (isVideo) "🎥 " else "📷 "); append(media.name)
                    append("\nGPS: "); append(if (hasGps) "ON" else "OFF")
                    if (hasGps) append("\n%.6f, %.6f".format(meta!!.getDouble("latitude"), meta.getDouble("longitude")))
                    append("\nTIME: "); append(if (meta?.has("timestamp") == true) "ON" else "OFF")
                    append("\nAUTH: "); append(if (meta?.has("authenticity") == true) "ON" else "OFF")
                    if (meta?.has("sha256") == true) append("\nSHA: ${meta.getString("sha256").take(12)}…")
                }
                setTextColor(Color.LTGRAY); setPadding(12, 0, 0, 0)
            }
            top.addView(details, LinearLayout.LayoutParams(0, -2, 1f)); row.addView(top)
            val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            actions.addView(Button(this).apply { text = "ВЫБРАТЬ"; setOnClickListener { selectedMedia = media; outputText.text = "Выбрано: ${media.name}" } }, LinearLayout.LayoutParams(0, -2, 1f))
            actions.addView(Button(this).apply { text = "TELEGRAM"; setOnClickListener { selectedMedia = media; shareSelectedMedia() } }, LinearLayout.LayoutParams(0, -2, 1f))
            actions.addView(Button(this).apply { text = "КАРТА"; isEnabled = hasGps; setOnClickListener { openMap(meta!!.getDouble("latitude"), meta.getDouble("longitude")) } }, LinearLayout.LayoutParams(0, -2, 1f))
            actions.addView(Button(this).apply { text = "УДАЛИТЬ"; setOnClickListener { Vault.deleteMedia(media); if (selectedMedia == media) selectedMedia = null; refreshGallery() } }, LinearLayout.LayoutParams(0, -2, 1f))
            row.addView(actions); galleryContainer.addView(row)
        }
    }

    private fun videoThumbnail(file: File) = runCatching { MediaMetadataRetriever().use { r -> r.setDataSource(file.absolutePath); r.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC) } }.getOrNull()

    private fun openMedia(file: File) {
        val type = if (file.extension.equals("mp4", true)) "video/mp4" else "image/jpeg"
        val intent = Intent(Intent.ACTION_VIEW).apply { setDataAndType(Uri.fromFile(file), type); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        runCatching { startActivity(intent) }.onFailure { showToast("Нет приложения для открытия файла") }
    }

    private fun shareSelectedMedia() {
        val media = selectedMedia ?: run { showToast("Сначала выберите фото или видео"); return }
        val type = if (media.extension.equals("mp4", true)) "video/mp4" else "image/jpeg"
        val intent = Intent(Intent.ACTION_SEND).apply { this.type = type; putExtra(Intent.EXTRA_STREAM, Uri.fromFile(media)); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        runCatching { startActivity(Intent.createChooser(intent, "Отправить через Telegram или другое приложение")) }.onFailure { showToast("Не удалось открыть меню отправки") }
    }

    private fun openMap(latitude: Double, longitude: Double) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("geo:$latitude,$longitude?q=$latitude,$longitude"))
        runCatching { startActivity(intent) }.onFailure { showToast("Нет приложения карт") }
    }

    private fun loadMe() = apiGet("/api/telegram/me") { result -> mainHandler.post { outputText.text = result } }

    private fun sendSelectedPhoto() {
        val photo = selectedMedia ?: run { showToast("Сначала выберите фото"); return }
        if (!photo.extension.equals("jpg", true)) { showToast("Core-отправка сейчас только для фото"); return }
        val chatId = chatIdInput.text.toString().trim()
        if (chatId.isEmpty()) { showToast("Введите Chat ID"); return }
        outputText.text = "Отправка фото в Telegram..."
        thread {
            try {
                val meta = Vault.metadata(photo); val base64 = Base64.encodeToString(photo.readBytes(), Base64.NO_WRAP)
                val hasGps = meta?.has("latitude") == true && meta.has("longitude") && !meta.isNull("latitude") && !meta.isNull("longitude")
                val caption = buildString {
                    append("SAMURAI CAMERA")
                    if (hasGps) append("\n📍 %.6f, %.6f".format(meta!!.getDouble("latitude"), meta.getDouble("longitude")))
                    if (meta?.has("timestamp") == true) append("\n🕒 ${meta.getLong("timestamp")}")
                    if (meta?.has("sha256") == true) append("\n🛡 SHA-256: ${meta.getString("sha256").take(16)}…")
                }
                val body = JSONObject().apply { put("chatId", chatId); put("fileName", photo.name); put("caption", caption); put("base64", base64) }.toString()
                apiPost("/api/telegram/send-photo", body) { result -> mainHandler.post { outputText.text = result } }
            } catch (e: Exception) { mainHandler.post { outputText.text = "ERROR: ${e.javaClass.simpleName}: ${e.message}" } }
        }
    }

    private fun sendSelectedLocation() {
        val media = selectedMedia ?: run { showToast("Сначала выберите материал"); return }
        val chatId = chatIdInput.text.toString().trim(); val meta = Vault.metadata(media)
        if (chatId.isEmpty()) { showToast("Введите Chat ID"); return }
        if (meta == null || meta.isNull("latitude") || meta.isNull("longitude")) { showToast("У материала нет координат"); return }
        val body = JSONObject().apply { put("chatId", chatId); put("latitude", meta.getDouble("latitude")); put("longitude", meta.getDouble("longitude")) }.toString()
        apiPost("/api/telegram/send-location", body) { result -> mainHandler.post { outputText.text = result } }
    }

    private fun checkCoreStatus() = apiGet("/health") { result -> mainHandler.post { if (result.startsWith("ERROR:")) statusText.text = "SAMURAI CAMERA · CORE OFFLINE" else updateModeText() } }

    private fun apiGet(path: String, callback: (String) -> Unit) {
        thread {
            var connection: HttpURLConnection? = null
            try {
                connection = (URL(coreUrl + path).openConnection() as HttpURLConnection).apply { requestMethod = "GET"; connectTimeout = 5000; readTimeout = 10000; useCaches = false; setRequestProperty("Accept", "application/json"); setRequestProperty("X-Request-ID", UUID.randomUUID().toString()) }
                val code = connection.responseCode; val stream = if (code in 200..299) connection.inputStream else connection.errorStream; val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
                callback(if (code in 200..299) body else "ERROR: HTTP $code\n$body")
            } catch (e: Exception) { callback("ERROR: ${e.javaClass.simpleName}: ${e.message}") } finally { connection?.disconnect() }
        }
    }

    private fun apiPost(path: String, json: String, callback: (String) -> Unit) {
        thread {
            var connection: HttpURLConnection? = null
            try {
                connection = (URL(coreUrl + path).openConnection() as HttpURLConnection).apply { requestMethod = "POST"; connectTimeout = 5000; readTimeout = 60000; useCaches = false; doOutput = true; setRequestProperty("Content-Type", "application/json; charset=UTF-8"); setRequestProperty("Accept", "application/json"); setRequestProperty("X-Request-ID", UUID.randomUUID().toString()) }
                connection.outputStream.use { output: OutputStream -> output.write(json.toByteArray(Charsets.UTF_8)); output.flush() }
                val code = connection.responseCode; val stream = if (code in 200..299) connection.inputStream else connection.errorStream; val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
                callback(if (code in 200..299) body else "ERROR: HTTP $code\n$body")
            } catch (e: Exception) { callback("ERROR: ${e.javaClass.simpleName}: ${e.message}") } finally { connection?.disconnect() }
        }
    }

    private fun showToast(message: String) = mainHandler.post { Toast.makeText(this, message, Toast.LENGTH_SHORT).show() }
}
