package com.samuraios.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Stores the Core URL in private app preferences and encrypts the API key
 * with an AES-GCM key held by Android Keystore. The key is never logged.
 */
class CoreConfigStore(context: Context) {
    private val prefs = context.getSharedPreferences("samurai_core_config", Context.MODE_PRIVATE)

    val baseUrl: String
        get() = (prefs.getString(KEY_URL, null) ?: BuildConfig.CORE_BASE_URL)
            .trim()
            .trimEnd('/')
            .takeUnless { it.contains("example.invalid", ignoreCase = true) }
            .orEmpty()

    fun apiKey(): String {
        val cipherText = prefs.getString(KEY_CIPHER, null) ?: return BuildConfig.CORE_API_KEY.trim()
        val ivText = prefs.getString(KEY_IV, null) ?: return ""
        return runCatching {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, loadKey(), GCMParameterSpec(128, Base64.decode(ivText, Base64.NO_WRAP)))
            String(cipher.doFinal(Base64.decode(cipherText, Base64.NO_WRAP)), Charsets.UTF_8)
        }.getOrDefault("")
    }

    fun save(urlInput: String, apiKeyInput: String): Boolean {
        val url = urlInput.trim().trimEnd('/')
        if (url.isNotEmpty()) {
            val valid = runCatching {
                val parsed = URL(url)
                parsed.protocol.equals("https", true) && !parsed.host.isNullOrBlank()
            }.getOrDefault(false)
            if (!valid) return false
        }

        return runCatching {
            val editor = prefs.edit().putString(KEY_URL, url)
            val newKey = apiKeyInput.trim()
            // An empty password field means "keep the saved key", not "erase it".
            if (newKey.isNotEmpty()) {
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.ENCRYPT_MODE, loadKey())
                val encrypted = cipher.doFinal(newKey.toByteArray(Charsets.UTF_8))
                editor.putString(KEY_CIPHER, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                    .putString(KEY_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            }
            editor.apply()
            true
        }.getOrDefault(false)
    }

    private fun loadKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }

    private companion object {
        const val KEY_ALIAS = "samurai_core_api_key_v1"
        const val KEY_URL = "core_url"
        const val KEY_CIPHER = "core_key_cipher"
        const val KEY_IV = "core_key_iv"
    }
}
