package com.samuraios.app

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.concurrent.thread

class MainActivity : Activity() {

    private val coreUrl = "http://127.0.0.1:8787"

    private lateinit var statusText: TextView
    private lateinit var outputText: TextView
    private lateinit var chatIdInput: EditText
    private lateinit var messageInput: EditText

    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        buildUi()
        checkCoreStatus()
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
            setBackgroundColor(Color.rgb(5, 8, 17))
        }

        statusText = TextView(this).apply {
            text = "SamuraiOS Core: проверка..."
            textSize = 20f
            setTextColor(Color.rgb(0, 255, 136))
            setPadding(0, 0, 0, 20)
        }

        root.addView(statusText)

        root.addView(
            Button(this).apply {
                text = "Проверить Core"
                setOnClickListener {
                    checkCoreStatus()
                }
            }
        )

        root.addView(
            Button(this).apply {
                text = "Мой Telegram"
                setOnClickListener {
                    loadMe()
                }
            }
        )

        root.addView(
            Button(this).apply {
                text = "Диалоги"
                setOnClickListener {
                    loadDialogs()
                }
            }
        )

        root.addView(
            TextView(this).apply {
                text = "Telegram чат"
                textSize = 18f
                setTextColor(Color.WHITE)
                setPadding(0, 24, 0, 8)
            }
        )

        chatIdInput = EditText(this).apply {
            hint = "Chat ID, например -100..."
            textSize = 16f
            setSingleLine(true)
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
        }

        root.addView(
            chatIdInput,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        )

        root.addView(
            Button(this).apply {
                text = "Загрузить сообщения"
                setOnClickListener {
                    loadMessages()
                }
            }
        )

        messageInput = EditText(this).apply {
            hint = "Сообщение..."
            textSize = 16f
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            gravity = Gravity.TOP
            minLines = 3
            maxLines = 6
        }

        root.addView(
            messageInput,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        )

        root.addView(
            Button(this).apply {
                text = "ОТПРАВИТЬ"
                setOnClickListener {
                    sendTelegramMessage()
                }
            }
        )

        outputText = TextView(this).apply {
            text = "SamuraiOS\n\nГотов к работе."
            textSize = 15f
            setTextColor(Color.LTGRAY)
            setPadding(0, 24, 0, 24)
        }

        root.addView(outputText)

        setContentView(
            ScrollView(this).apply {
                addView(root)
            }
        )
    }

    private fun checkCoreStatus() {
        statusText.text = "SamuraiOS Core: проверка..."

        apiGet("/api/status") { result ->
            mainHandler.post {
                if (result.startsWith("ERROR:")) {
                    statusText.text = "Core: OFFLINE"
                    outputText.text = result
                } else {
                    statusText.text = "SamuraiOS Core: ONLINE"
                    outputText.text = result
                }
            }
        }
    }

    private fun loadMe() {
        outputText.text = "Загрузка Telegram..."

        apiGet("/api/telegram/me") { result ->
            mainHandler.post {
                outputText.text = result
            }
        }
    }

    private fun loadDialogs() {
        outputText.text = "Загрузка диалогов..."

        apiGet("/api/telegram/dialogs?limit=20") { result ->
            mainHandler.post {
                outputText.text = result
            }
        }
    }

    private fun loadMessages() {
        val chatId = chatIdInput.text.toString().trim()

        if (chatId.isEmpty()) {
            showToast("Введите Chat ID")
            return
        }

        outputText.text = "Загрузка сообщений..."

        apiGet(
            "/api/telegram/messages?chatId=${encodeUrl(chatId)}&limit=30"
        ) { result ->
            mainHandler.post {
                outputText.text = result
            }
        }
    }

    private fun sendTelegramMessage() {
        val chatId = chatIdInput.text.toString().trim()
        val message = messageInput.text.toString().trim()

        if (chatId.isEmpty()) {
            showToast("Введите Chat ID")
            return
        }

        if (message.isEmpty()) {
            showToast("Введите сообщение")
            return
        }

        outputText.text = "Отправка..."

        val json = buildJson(
            chatId = chatId,
            message = message
        )

        apiPost("/api/telegram/send", json) { result ->
            mainHandler.post {
                outputText.text = result

                if (!result.startsWith("ERROR:")) {
                    messageInput.setText("")
                    showToast("Сообщение отправлено")
                }
            }
        }
    }

    private fun apiGet(
        path: String,
        callback: (String) -> Unit
    ) {
        thread {
            var connection: HttpURLConnection? = null

            try {
                val url = URL(coreUrl + path)

                connection =
                    url.openConnection() as HttpURLConnection

                connection.requestMethod = "GET"
                connection.connectTimeout = 5000
                connection.readTimeout = 10000
                connection.useCaches = false

                val code = connection.responseCode

                val stream =
                    if (code in 200..299) {
                        connection.inputStream
                    } else {
                        connection.errorStream
                    }

                val body =
                    stream?.bufferedReader()?.use {
                        it.readText()
                    } ?: ""

                callback(
                    if (code in 200..299) {
                        body
                    } else {
                        "ERROR: HTTP $code\n$body"
                    }
                )

            } catch (e: Exception) {
                callback(
                    "ERROR: ${e.javaClass.simpleName}: ${e.message}"
                )
            } finally {
                connection?.disconnect()
            }
        }
    }

    private fun apiPost(
        path: String,
        json: String,
        callback: (String) -> Unit
    ) {
        thread {
            var connection: HttpURLConnection? = null

            try {
                val url = URL(coreUrl + path)

                connection =
                    url.openConnection() as HttpURLConnection

                connection.requestMethod = "POST"
                connection.connectTimeout = 5000
                connection.readTimeout = 15000
                connection.useCaches = false
                connection.doOutput = true

                connection.setRequestProperty(
                    "Content-Type",
                    "application/json; charset=UTF-8"
                )

                connection.setRequestProperty(
                    "Accept",
                    "application/json"
                )

                val bytes = json.toByteArray(Charsets.UTF_8)

                connection.outputStream.use { output: OutputStream ->
                    output.write(bytes)
                    output.flush()
                }

                val code = connection.responseCode

                val stream =
                    if (code in 200..299) {
                        connection.inputStream
                    } else {
                        connection.errorStream
                    }

                val body =
                    stream?.bufferedReader()?.use {
                        it.readText()
                    } ?: ""

                callback(
                    if (code in 200..299) {
                        body
                    } else {
                        "ERROR: HTTP $code\n$body"
                    }
                )

            } catch (e: Exception) {
                callback(
                    "ERROR: ${e.javaClass.simpleName}: ${e.message}"
                )
            } finally {
                connection?.disconnect()
            }
        }
    }

    private fun buildJson(
        chatId: String,
        message: String
    ): String {
        return """
            {
              "chatId":"${jsonEscape(chatId)}",
              "message":"${jsonEscape(message)}"
            }
        """.trimIndent()
    }

    private fun jsonEscape(value: String): String {
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
    }

    private fun encodeUrl(value: String): String {
        return URLEncoder.encode(value, "UTF-8")
    }

    private fun showToast(message: String) {
        mainHandler.post {
            Toast.makeText(
                this,
                message,
                Toast.LENGTH_SHORT
            ).show()
        }
    }
}
