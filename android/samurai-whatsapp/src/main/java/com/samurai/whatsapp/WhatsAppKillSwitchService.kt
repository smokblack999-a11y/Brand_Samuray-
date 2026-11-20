package com.samurai.whatsapp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import java.io.FileInputStream
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean

/**
 * User-consented, local-only network stop for WhatsApp packages.
 * Only WhatsApp traffic is routed to this TUN interface; packets are discarded,
 * while other applications continue to use their normal network.
 */
class WhatsAppKillSwitchService : VpnService() {
    @Volatile private var tunnel: ParcelFileDescriptor? = null
    @Volatile private var readerThread: Thread? = null
    private val stopping = AtomicBoolean(false)

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopTunnel()
                stopSelf(startId)
                return START_NOT_STICKY
            }
            ACTION_START, null -> startTunnel()
            else -> return START_NOT_STICKY
        }
        return START_NOT_STICKY
    }

    private fun startTunnel() {
        if (tunnel != null) return
        stopping.set(false)
        runCatching {
            createNotificationChannel()
            val notification = buildNotification()
            val builder = Builder()
                .setSession("SAMURAI WhatsApp Internet Block")
                .setMtu(1500)
                .addAddress("10.77.0.1", 32)
                .addRoute("0.0.0.0", 0)
                .addAddress("fd77:77:77::1", 128)
                .addRoute("::", 0)

            var allowlisted = 0
            for (packageName in TARGET_PACKAGES) {
                try {
                    packageManager.getApplicationInfo(packageName, 0)
                    builder.addAllowedApplication(packageName)
                    allowlisted += 1
                } catch (_: PackageManager.NameNotFoundException) {
                    // WhatsApp or WhatsApp Business may not be installed.
                }
            }
            check(allowlisted > 0) { "WhatsApp or WhatsApp Business is not installed" }

            val established = builder.establish()
                ?: throw IllegalStateException("Android did not establish the VPN interface")
            tunnel = established

            // SYSTEM_EXEMPTED is permitted for an active VPN app; establish the VPN first.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }

            check(
                getSharedPreferences(PREFS, MODE_PRIVATE)
                    .edit()
                    .putBoolean(KEY_ENABLED, true)
                    .commit()
            ) { "Could not persist VPN state" }
            activeInProcess = true

            readerThread = Thread({
                val buffer = ByteArray(32 * 1024)
                try {
                    FileInputStream(established.fileDescriptor).use { input ->
                        while (!stopping.get()) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            // Deliberately discard packets: no payload is stored, parsed or forwarded.
                        }
                    }
                } catch (_: IOException) {
                    // Closing the TUN descriptor is the normal stop signal.
                } finally {
                    if (!stopping.get()) {
                        stopping.set(true)
                        tunnel = null
                        activeInProcess = false
                        getSharedPreferences(PREFS, MODE_PRIVATE)
                            .edit().putBoolean(KEY_ENABLED, false).commit()
                        stopForeground(STOP_FOREGROUND_REMOVE)
                        stopSelf()
                    }
                }
            }, "samurai-whatsapp-packet-drop").apply {
                isDaemon = true
                start()
            }
        }.onFailure { error ->
            stopTunnel()
            getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit().putBoolean(KEY_ENABLED, false).commit()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            android.util.Log.e(TAG, "Could not start WhatsApp network block", error)
        }
    }

    private fun stopTunnel() {
        stopping.set(true)
        activeInProcess = false
        val current = tunnel
        tunnel = null
        runCatching { current?.close() }
        readerThread = null
        getSharedPreferences(PREFS, MODE_PRIVATE)
            .edit().putBoolean(KEY_ENABLED, false).commit()
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    override fun onRevoke() {
        stopTunnel()
        stopSelf()
        super.onRevoke()
    }

    override fun onDestroy() {
        stopTunnel()
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "WhatsApp Internet Block",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Visible status of the user-enabled WhatsApp network block"
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val stopIntent = Intent(this, WhatsAppKillSwitchService::class.java)
            .setAction(ACTION_STOP)
        val stopPendingIntent = android.app.PendingIntent.getService(
            this,
            91,
            stopIntent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    android.app.PendingIntent.FLAG_IMMUTABLE
                } else 0
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentTitle("SAMURAI: WhatsApp заблокирован")
            .setContentText("Интернет WhatsApp выключен. Нажми «Восстановить», чтобы вернуть сеть.")
            .setOngoing(true)
            .addAction(
                android.R.drawable.ic_media_play,
                "Восстановить сеть",
                stopPendingIntent
            )
            .build()
    }

    companion object {
        const val ACTION_START = "com.samurai.whatsapp.action.BLOCK_WHATSAPP"
        const val ACTION_STOP = "com.samurai.whatsapp.action.UNBLOCK_WHATSAPP"
        private const val PREFS = "samurai_whatsapp_kill_switch"
        private const val KEY_ENABLED = "enabled"
        private const val CHANNEL_ID = "samurai_whatsapp_network_block"
        private const val NOTIFICATION_ID = 771
        private const val TAG = "SamuraiWhatsAppVPN"
        private val TARGET_PACKAGES = listOf("com.whatsapp", "com.whatsapp.w4b")
        @Volatile private var activeInProcess = false

        fun isEnabled(context: android.content.Context): Boolean {
            val prefs = context.getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE)
            val stored = prefs.getBoolean(KEY_ENABLED, false)
            if (stored && !activeInProcess) {
                // A persisted flag alone cannot prove that VPN survived process death.
                prefs.edit().putBoolean(KEY_ENABLED, false).apply()
            }
            return stored && activeInProcess
        }

        fun markDisabled(context: android.content.Context) {
            activeInProcess = false
            context.getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE)
                .edit().putBoolean(KEY_ENABLED, false).commit()
        }
    }
}
