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

internal enum class WhatsAppKillSwitchState {
    DISABLED, STARTING, ENABLED, STOPPING, FAILED
}

/**
 * User-consented, local-only network stop for WhatsApp packages.
 * Only WhatsApp traffic is routed to this TUN interface; packets are discarded,
 * while other applications continue to use their normal network.
 */
class WhatsAppKillSwitchService : VpnService() {
    private var tunnel: ParcelFileDescriptor? = null
    private var readerThread: Thread? = null
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
            persistState(this, WhatsAppKillSwitchState.STARTING)
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

            activeInProcess = true
            persistState(this, WhatsAppKillSwitchState.ENABLED)

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
                        runCatching { persistState(this@WhatsAppKillSwitchService, WhatsAppKillSwitchState.DISABLED) }
                            .onFailure { android.util.Log.e(TAG, "Could not persist VPN shutdown", it) }
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
            runCatching { persistState(this, WhatsAppKillSwitchState.FAILED) }
                .onFailure { android.util.Log.e(TAG, "Could not persist VPN failure", it) }
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            android.util.Log.e(TAG, "Could not start WhatsApp network block", error)
        }
    }

    private fun stopTunnel() {
        stopping.set(true)
        val wasActive = activeInProcess || tunnel != null
        activeInProcess = false
        val current = tunnel
        tunnel = null
        runCatching { current?.close() }
        readerThread = null
        if (wasActive || state(this) != WhatsAppKillSwitchState.FAILED) {
            runCatching { persistState(this, WhatsAppKillSwitchState.DISABLED) }
                .onFailure { android.util.Log.e(TAG, "Could not persist VPN shutdown", it) }
        }
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
        const val ACTION_STATE_CHANGED = "com.samurai.whatsapp.action.STATE_CHANGED"
        const val EXTRA_STATE = "state"
        private const val PREFS = "samurai_whatsapp_kill_switch"
        private const val KEY_ENABLED = "enabled"
        private const val KEY_STATE = "state"
        private const val CHANNEL_ID = "samurai_whatsapp_network_block"
        private const val NOTIFICATION_ID = 771
        private const val TAG = "SamuraiWhatsAppVPN"
        private val TARGET_PACKAGES = listOf("com.whatsapp", "com.whatsapp.w4b")
        @Volatile private var activeInProcess = false

        internal fun state(context: android.content.Context): WhatsAppKillSwitchState {
            val prefs = context.getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE)
            val saved = runCatching {
                val raw = prefs.getString(KEY_STATE, null)
                    ?: if (prefs.getBoolean(KEY_ENABLED, false)) "ENABLED" else "DISABLED"
                WhatsAppKillSwitchState.valueOf(raw)
            }.getOrDefault(WhatsAppKillSwitchState.DISABLED)
            if (!activeInProcess && (saved == WhatsAppKillSwitchState.ENABLED || saved == WhatsAppKillSwitchState.STOPPING)) {
                persistState(context, WhatsAppKillSwitchState.DISABLED)
                return WhatsAppKillSwitchState.DISABLED
            }
            return saved
        }

        internal fun isEnabled(context: android.content.Context): Boolean =
            state(context) == WhatsAppKillSwitchState.ENABLED && activeInProcess

        internal fun setRequestedState(context: android.content.Context, value: WhatsAppKillSwitchState) {
            persistState(context, value)
        }

        private fun persistState(context: android.content.Context, value: WhatsAppKillSwitchState) {
            val saved = context.getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_STATE, value.name)
                .putBoolean(KEY_ENABLED, value == WhatsAppKillSwitchState.ENABLED)
                .commit()
            check(saved) { "Could not persist WhatsApp VPN state" }
            context.sendBroadcast(
                Intent(ACTION_STATE_CHANGED)
                    .setPackage(context.packageName)
                    .putExtra(EXTRA_STATE, value.name)
            )
        }
    }
}
