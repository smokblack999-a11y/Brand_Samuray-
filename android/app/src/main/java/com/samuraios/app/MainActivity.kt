package com.samuraios.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
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
    private lateinit var galleryContainer: LinearLayout
    private var imageCapture: ImageCapture? = null
    private var selectedPhoto: File? = null
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

    override fun onDestroy() { cameraExecutor?.shutdown(); super.onDestroy() }

    private fun requestMissingPermissions() {
        val missing = arrayOf(Manifest.permission.CAMERA, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            .filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
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
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20, 20, 20, 28)
            setBackgroundColor(Color.rgb(5, 8, 17))
        }
        statusText = TextView(this).apply {
            text = "SAMURAI CAMERA · STARTING"
            textSize = 20f
            setTextColor(Color.rgb(0, 255, 136))
            setPadding(0, 0, 0, 12)
        }
        root.addView(statusText)
        previewView = PreviewView(this).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
        root.addView(previewView, LinearLayout.LayoutParams(-1, 520))
        root.addView(Button(this).apply { text = "СНЯТЬ ФОТО + КООРДИНАТЫ"; setOnClickListener { capturePhoto() } })
        root.addView(Button(this).apply { text = "ОБНОВИТЬ ГАЛЕРЕЮ"; setOnClickListener { refreshGallery() } })
        root.addView(TextView(this).apply {
            text = "GALLERY · PHOTO + GPS · TELEGRAM"
            textSize = 18f
            setTextColor(Color.WHITE)
            setPadding(0, 20, 0, 8)
        })
        galleryContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(galleryContainer)
        root.addView(TextView(this).apply { text = "Telegram Chat ID"; setTextColor(Color.LTGRAY); setPadding(0, 18, 0, 4) })
        chatIdInput = EditText(this).apply {
            hint = "например -1001234567890"
            setSingleLine(true)
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            inputType = android.text.InputType.TYPE_CLASS_TEXT
        }
        root.addView(chatIdInput, LinearLayout.LayoutParams(-1, -2))
        root.addView(Button(this).apply { text = "ПРОВЕРИТЬ TELEGRAM"; setOnClickListener { loadMe() } })
        root.addView(Button(this).apply { text = "ОТПРАВИТЬ ВЫБРАННОЕ ФОТО + GPS"; setOnClickListener { sendSelectedPhoto() } })
        root.addView(Button(this).apply { text = "ОТПРАВИТЬ ТОЛЬКО GPS"; setOnClickListener { sendSelectedLocation() } })
        outputText = TextView(this).apply {
            text = "Выберите фото в галерее. Фото можно открыть на карте и отправить в Telegram вместе с координатами."
            textSize = 14f
            setTextColor(Color.LTGRAY)
            setPadding(0, 18, 0, 18)
        }
        root.addView(outputText)
        setContentView(ScrollView(this).apply { addView(root) })
    }

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            try {
                val provider = future.get()
                val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
                imageCapture = ImageCapture.Builder().setJpegQuality(88).build()
                provider.unbindAll()
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageCapture)
                statusText.text = "SAMURAI CAMERA · ONLINE"
            } catch (e: Exception) { statusText.text = "CAMERA ERROR: ${e.message}" }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun capturePhoto() {
        val capture = imageCapture ?: run { showToast("Камера ещё не готова"); return }
        val file = Vault.createPhotoFile(this)
        val timestamp = System.currentTimeMillis()
        capture.takePicture(ImageCapture.OutputFileOptions.Builder(file).build(), cameraExecutor!!, object : ImageCapture.OnImageSavedCallback {
            override fun onError(exception: ImageCaptureException) { file.delete(); showToast("Ошибка камеры: ${exception.message}") }
            override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) { saveLocation(file, timestamp) }
        })
    }

    private fun saveLocation(photo: File, timestamp: Long) {
        val fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!fine && !coarse) {
            Vault.saveMetadata(photo, null, null, null, timestamp)
            mainHandler.post { refreshGallery(); outputText.text = "Фото сохранено. GPS выключен/разрешение не дано." }
            return
        }
        locationClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, CancellationTokenSource().token)
            .addOnSuccessListener { location ->
                Vault.saveMetadata(photo, location?.latitude, location?.longitude, location?.accuracy, timestamp)
                mainHandler.post {
                    refreshGallery()
                    outputText.text = if (location != null) "Сохранено: %.6f, %.6f · точность %.1f м".format(location.latitude, location.longitude, location.accuracy) else "Фото сохранено без GPS fix"
                }
            }
            .addOnFailureListener {
                Vault.saveMetadata(photo, null, null, null, timestamp)
                mainHandler.post { refreshGallery(); outputText.text = "Фото сохранено, GPS fix недоступен" }
            }
    }

    private fun refreshGallery() {
        galleryContainer.removeAllViews()
        val photos = Vault.listPhotos(this)
        if (photos.isEmpty()) {
            galleryContainer.addView(TextView(this).apply { text = "Пока нет фото"; setTextColor(Color.GRAY); setPadding(0, 8, 0, 8) })
            return
        }
        photos.forEach { photo ->
            val meta = Vault.metadata(photo)
            val row = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, 8, 0, 8) }
            val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            val image = ImageView(this).apply { setImageURI(Uri.fromFile(photo)); scaleType = ImageView.ScaleType.CENTER_CROP }
            top.addView(image, LinearLayout.LayoutParams(180, 130))
            val hasGps = meta?.has("latitude") == true && !meta.isNull("latitude") && meta.has("longitude") && !meta.isNull("longitude")
            val details = TextView(this).apply {
                text = if (hasGps) "${photo.name}\n%.6f, %.6f\n± %.1f м".format(meta!!.getDouble("latitude"), meta.getDouble("longitude"), meta.optDouble("accuracyMeters", 0.0)) else "${photo.name}\nGPS: нет"
                setTextColor(Color.LTGRAY)
                setPadding(12, 0, 0, 0)
            }
            top.addView(details, LinearLayout.LayoutParams(0, -2, 1f))
            row.addView(top)
            val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            actions.addView(Button(this).apply { text = "ВЫБРАТЬ"; setOnClickListener { selectedPhoto = photo; outputText.text = "Выбрано: ${photo.name}" } }, LinearLayout.LayoutParams(0, -2, 1f))
            actions.addView(Button(this).apply { text = "КАРТА"; isEnabled = hasGps; setOnClickListener { openMap(meta!!.getDouble("latitude"), meta.getDouble("longitude")) } }, LinearLayout.LayoutParams(0, -2, 1f))
            actions.addView(Button(this).apply { text = "УДАЛИТЬ"; setOnClickListener { Vault.deletePhoto(photo); if (selectedPhoto == photo) selectedPhoto = null; refreshGallery() } }, LinearLayout.LayoutParams(0, -2, 1f))
            row.addView(actions)
            galleryContainer.addView(row)
        }
    }

    private fun openMap(latitude: Double, longitude: Double) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("geo:$latitude,$longitude?q=$latitude,$longitude"))
        runCatching { startActivity(intent) }.onFailure { showToast("Нет приложения карт") }
    }

    private fun loadMe() = apiGet("/api/telegram/me") { result -> mainHandler.post { outputText.text = result } }

    private fun sendSelectedPhoto() {
        val photo = selectedPhoto ?: run { showToast("Сначала выберите фото"); return }
        val chatId = chatIdInput.text.toString().trim()
        if (chatId.isEmpty()) { showToast("Введите Chat ID"); return }
        outputText.text = "Отправка фото в Telegram..."
        thread {
            try {
                val meta = Vault.metadata(photo)
                val base64 = Base64.encodeToString(photo.readBytes(), Base64.NO_WRAP)
                val hasGps = meta?.has("latitude") == true && !meta.isNull("latitude") && meta.has("longitude") && !meta.isNull("longitude")
                val lat = if (hasGps) meta!!.getDouble("latitude") else null
                val lon = if (hasGps) meta!!.getDouble("longitude") else null
                val caption = if (hasGps) "SAMURAI CAMERA\n📍 %.6f, %.6f\nТочность: ± %.1f м".format(lat, lon, meta!!.optDouble("accuracyMeters", 0.0)) else "SAMURAI CAMERA\nGPS: нет fix"
                val body = JSONObject().apply {
                    put("chatId", chatId); put("fileName", photo.name); put("caption", caption); put("base64", base64)
                    if (lat != null && lon != null) { put("latitude", lat); put("longitude", lon) }
                }.toString()
                apiPost("/api/telegram/send-photo", body) { result -> mainHandler.post { outputText.text = result } }
            } catch (e: Exception) { mainHandler.post { outputText.text = "ERROR: ${e.javaClass.simpleName}: ${e.message}" } }
        }
    }

    private fun sendSelectedLocation() {
        val photo = selectedPhoto ?: run { showToast("Сначала выберите фото"); return }
        val chatId = chatIdInput.text.toString().trim()
        val meta = Vault.metadata(photo)
        if (chatId.isEmpty()) { showToast("Введите Chat ID"); return }
        if (meta == null || meta.isNull("latitude") || meta.isNull("longitude")) { showToast("У фото нет координат"); return }
        val body = JSONObject().apply { put("chatId", chatId); put("latitude", meta.getDouble("latitude")); put("longitude", meta.getDouble("longitude")) }.toString()
        apiPost("/api/telegram/send-location", body) { result -> mainHandler.post { outputText.text = result } }
    }

    private fun checkCoreStatus() = apiGet("/health") { result -> mainHandler.post { statusText.text = if (result.startsWith("ERROR:")) "SAMURAI CAMERA · CORE OFFLINE" else "SAMURAI CAMERA · CORE ONLINE" } }

    private fun apiGet(path: String, callback: (String) -> Unit) {
        thread {
            var connection: HttpURLConnection? = null
            try {
                connection = (URL(coreUrl + path).openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"; connectTimeout = 5000; readTimeout = 10000; useCaches = false
                    setRequestProperty("Accept", "application/json"); setRequestProperty("X-Request-ID", UUID.randomUUID().toString())
                }
                val code = connection.responseCode
                val stream = if (code in 200..299) connection.inputStream else connection.errorStream
                val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
                callback(if (code in 200..299) body else "ERROR: HTTP $code\n$body")
            } catch (e: Exception) { callback("ERROR: ${e.javaClass.simpleName}: ${e.message}") } finally { connection?.disconnect() }
        }
    }

    private fun apiPost(path: String, json: String, callback: (String) -> Unit) {
        thread {
            var connection: HttpURLConnection? = null
            try {
                connection = (URL(coreUrl + path).openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"; connectTimeout = 5000; readTimeout = 60000; useCaches = false; doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=UTF-8"); setRequestProperty("Accept", "application/json")
                    setRequestProperty("X-Request-ID", UUID.randomUUID().toString())
                }
                connection.outputStream.use { output: OutputStream -> output.write(json.toByteArray(Charsets.UTF_8)); output.flush() }
                val code = connection.responseCode
                val stream = if (code in 200..299) connection.inputStream else connection.errorStream
                val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
                callback(if (code in 200..299) body else "ERROR: HTTP $code\n$body")
            } catch (e: Exception) { callback("ERROR: ${e.javaClass.simpleName}: ${e.message}") } finally { connection?.disconnect() }
        }
    }

    private fun showToast(message: String) = mainHandler.post { Toast.makeText(this, message, Toast.LENGTH_SHORT).show() }
}
