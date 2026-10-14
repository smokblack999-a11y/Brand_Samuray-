package com.samuraios.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.net.URI
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Stores the server URL in private app preferences and encrypts the Core API key
 * with a non-exportable Android Keystore AES key. The API key is never compiled
 * into the APK. This is local at-rest protection, not a replacement for server-side
 * per-user authentication or key rotation.
 */
object CoreConfigStore {
    data class Config(val baseUrl: String, val apiKey: String)

    private const val PREFS = "samurai_core_config"
    private const val KEY_BASE_URL = "base_url"
    private const val KEY_API_KEY_CIPHERTEXT = "api_key_ciphertext"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "samurai_core_api_key_v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS = 128
    private const val GCM_IV_BYTES = 12

    fun load(context: Context): Config {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val fallbackUrl = BuildConfig.CORE_BASE_URL.trimEnd('/')
        val storedUrl = prefs.getString(KEY_BASE_URL, null)?.trimEnd('/')
        val encryptedKey = prefs.getString(KEY_API_KEY_CIPHERTEXT, null)
        val apiKey = runCatching { decrypt(encryptedKey) }.getOrDefault("")
        return Config(storedUrl?.takeIf { it.isNotBlank() } ?: fallbackUrl, apiKey)
    }

    fun save(context: Context, baseUrl: String, apiKey: String?) {
        val normalizedUrl = normalizeHttpsBaseUrl(baseUrl)
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val editor = prefs.edit().putString(KEY_BASE_URL, normalizedUrl)
        if (!apiKey.isNullOrBlank()) {
            editor.putString(KEY_API_KEY_CIPHERTEXT, encrypt(apiKey.trim()))
        }
        check(editor.commit()) { "Не удалось сохранить настройки Core" }
    }

    fun normalizeHttpsBaseUrl(raw: String): String {
        val candidate = raw.trim().trimEnd('/')
        require(candidate.isNotBlank()) { "Укажите HTTPS-адрес Core" }
        val uri = try {
            URI(candidate)
        } catch (_: Exception) {
            throw IllegalArgumentException("Некорректный URL Core")
        }
        require(uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrBlank()) {
            "Для защиты API-ключа требуется действительный HTTPS-адрес Core"
        }
        require(uri.userInfo == null && uri.query == null && uri.fragment == null) {
            "URL Core не должен содержать логин, пароль, query или fragment"
        }
        val host = uri.host.lowercase()
        require(
            !host.endsWith(".invalid") &&
            !host.endsWith(".example") &&
            host !in setOf("example.com", "example.net", "example.org", "localhost")
        ) {
            "Замените демонстрационный домен на реальный адрес Core"
        }
        return candidate
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }

    private fun encrypt(plainText: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(plainText.toByteArray(Charsets.UTF_8))
        val combined = cipher.iv + encrypted
        return Base64.encodeToString(combined, Base64.NO_WRAP)
    }

    private fun decrypt(encoded: String?): String {
        if (encoded.isNullOrBlank()) return ""
        val combined = Base64.decode(encoded, Base64.NO_WRAP)
        require(combined.size > GCM_IV_BYTES) { "Зашифрованный API-ключ повреждён" }
        val iv = combined.copyOfRange(0, GCM_IV_BYTES)
        val encrypted = combined.copyOfRange(GCM_IV_BYTES, combined.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        return String(cipher.doFinal(encrypted), Charsets.UTF_8)
    }
}
