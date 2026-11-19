package com.samuraios.app.messenger

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit

class MessengerApi(
    private val baseUrl: String,
    private val store: SecureStore
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .build()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    data class AuthResult(val userId: String, val username: String)
    data class Conversation(val id: String, val peerName: String, val peerUsername: String)
    data class Message(
        val id: String,
        val senderId: String,
        val createdAt: String,
        val ciphertext: String,
        val nonce: String,
        val deliveredAt: String?,
        val readAt: String?
    )

    private fun request(
        path: String,
        method: String = "GET",
        body: JSONObject? = null,
        token: String? = null
    ): Request {
        val builder = Request.Builder().url(baseUrl.trimEnd('/') + path).header("Accept", "application/json")
        if (token != null) builder.header("Authorization", "Bearer " + token)
        if (body != null) builder.method(method, body.toString().toRequestBody(jsonType))
        else if (method != "GET") builder.method(method, ByteArray(0).toRequestBody(jsonType))
        return builder.build()
    }

    private fun parse(response: Response): JSONObject {
        val body = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
            val code = runCatching { JSONObject(body).optString("error") }.getOrNull().orEmpty()
            throw ApiException(response.code, if (code.isNotBlank()) code else body.take(180))
        }
        return if (body.isBlank()) JSONObject() else JSONObject(body)
    }

    private fun call(req: Request): JSONObject = client.newCall(req).execute().use { parse(it) }

    private fun authRequest(path: String, body: JSONObject): JSONObject =
        call(request(path, "POST", body))

    private fun storeAuth(json: JSONObject): AuthResult {
        val user = json.getJSONObject("user")
        store.saveSession(
            json.getString("accessToken"),
            json.getString("refreshToken"),
            user.getString("id"),
            user.getString("username")
        )
        return AuthResult(user.getString("id"), user.getString("username"))
    }

    fun register(username: String, displayName: String, password: String): AuthResult =
        storeAuth(authRequest(
            "/v1/auth/register",
            JSONObject().put("username", username).put("displayName", displayName).put("password", password)
        ))

    fun login(username: String, password: String): AuthResult =
        storeAuth(authRequest(
            "/v1/auth/login",
            JSONObject().put("username", username).put("password", password)
        ))

    private fun refreshSession(): Boolean {
        val refresh = store.refreshToken() ?: return false
        return try {
            val json = authRequest("/v1/auth/refresh", JSONObject().put("refreshToken", refresh))
            storeAuth(json)
            true
        } catch (error: ApiException) {
            // Revoke local credentials only when the server explicitly rejects
            // the refresh token. Transient network outages must keep the
            // encrypted session and durable outbox for later retry.
            if (error.httpCode == 401) {
                store.clearSession()
                return false
            }
            throw error
        }
    }

    private fun authorized(path: String, method: String = "GET", body: JSONObject? = null): JSONObject {
        val token = store.accessToken() ?: throw ApiException(401, "Требуется вход")
        try {
            return call(request(path, method, body, token))
        } catch (error: ApiException) {
            if (error.httpCode != 401 || !refreshSession()) throw error
            val renewed = store.accessToken() ?: throw ApiException(401, "Сессия завершена")
            return call(request(path, method, body, renewed))
        }
    }

    fun logout() {
        val refresh = store.refreshToken()
        if (refresh != null) runCatching {
            authRequest("/v1/auth/logout", JSONObject().put("refreshToken", refresh))
        }
        store.clearSession()
    }

    fun privacy(): JSONObject = authorized("/v1/privacy").getJSONObject("privacy")
    fun updatePrivacy(values: JSONObject): JSONObject =
        authorized("/v1/privacy", "PATCH", values).getJSONObject("privacy")

    fun createDirect(username: String): Conversation {
        val json = authorized("/v1/conversations/direct", "POST", JSONObject().put("username", username))
        val conversation = json.getJSONObject("conversation")
        val peer = conversation.getJSONObject("peer")
        return Conversation(
            conversation.getString("id"),
            peer.optString("display_name", username),
            peer.optString("username", username)
        )
    }

    fun conversations(): List<Conversation> {
        val array = authorized("/v1/conversations").getJSONArray("conversations")
        return (0 until array.length()).map { index ->
            val item = array.getJSONObject(index)
            Conversation(
                item.getString("id"),
                item.optString("peer_name", item.optString("title", "Диалог")),
                item.optString("peer_username", "")
            )
        }
    }

    fun messages(conversationId: String): List<Message> {
        val array = authorized("/v1/conversations/" + conversationId + "/messages?limit=100").getJSONArray("messages")
        return (0 until array.length()).map { index ->
            val item = array.getJSONObject(index)
            Message(
                item.getString("id"),
                item.getString("sender_id"),
                item.getString("created_at"),
                item.getString("payload_ciphertext"),
                item.getString("payload_nonce"),
                item.optString("delivered_at").takeIf { it.isNotBlank() && it != "null" },
                item.optString("read_at").takeIf { it.isNotBlank() && it != "null" }
            )
        }.reversed()
    }

    fun send(conversationId: String, encrypted: EncryptedMessage, clientMessageId: String = UUID.randomUUID().toString()): JSONObject {
        val body = JSONObject()
            .put("clientMessageId", clientMessageId)
            .put("ciphertext", encrypted.ciphertext)
            .put("nonce", encrypted.nonce)
            .put("protocolVersion", 1)
        return authorized("/v1/conversations/" + conversationId + "/messages", "POST", body).getJSONObject("message")
    }

    fun acknowledgeDelivered(messageId: String) =
        authorized("/v1/messages/" + messageId + "/delivered", "POST")

    fun acknowledgeRead(messageId: String) =
        authorized("/v1/messages/" + messageId + "/read", "POST")

    fun connectRealtime(listener: WebSocketListener): WebSocket {
        val token = store.accessToken() ?: throw ApiException(401, "Требуется вход")
        val wsUrl = baseUrl.trimEnd('/')
            .replaceFirst("https://", "wss://")
            .replaceFirst("http://", "ws://") + "/v1/realtime"
        val request = Request.Builder().url(wsUrl).header("Authorization", "Bearer " + token).build()
        return client.newWebSocket(request, listener)
    }
}

class ApiException(val httpCode: Int, message: String) : IOException(message)
