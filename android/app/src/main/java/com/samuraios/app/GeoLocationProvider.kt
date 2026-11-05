package com.samuraios.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Location provider based on Android framework APIs only.
 * Does not require Google Play Services or network access to a proprietary SDK.
 * GPS/network providers may still depend on device hardware, settings and permissions.
 */
object GeoLocationProvider {
    private const val TIMEOUT_MS = 8_000L

    fun current(context: Context, callback: (Location?) -> Unit) {
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!fine && !coarse) {
            callback(null)
            return
        }

        val providers = runCatching { manager.getProviders(true) }
            .getOrDefault(emptyList())
            .filter { it == LocationManager.GPS_PROVIDER || it == LocationManager.NETWORK_PROVIDER }

        if (providers.isEmpty()) {
            callback(null)
            return
        }

        val lastKnown = providers.mapNotNull { provider ->
            runCatching { manager.getLastKnownLocation(provider) }.getOrNull()
        }.maxByOrNull { it.time }

        // Prefer a fresh cached fix to avoid delaying the shutter-to-gallery flow.
        if (lastKnown != null && System.currentTimeMillis() - lastKnown.time <= 30_000L) {
            callback(lastKnown)
            return
        }

        val handler = Handler(Looper.getMainLooper())
        val completed = AtomicBoolean(false)
        val listeners = mutableListOf<LocationListener>()
        fun finish(location: Location?) {
            if (!completed.compareAndSet(false, true)) return
            handler.removeCallbacksAndMessages(null)
            listeners.forEach { listener -> runCatching { manager.removeUpdates(listener) } }
            callback(location ?: lastKnown)
        }

        handler.postDelayed({ finish(null) }, TIMEOUT_MS)
        providers.forEach { provider ->
            val listener = object : LocationListener {
                override fun onLocationChanged(location: Location) {
                    finish(location)
                }
            }
            listeners += listener
            try {
                manager.requestSingleUpdate(provider, listener, Looper.getMainLooper())
            } catch (_: SecurityException) {
                // Permissions can be revoked while the request is being registered.
            } catch (_: IllegalArgumentException) {
                // Provider disappeared between discovery and request.
            }
        }
        if (listeners.isEmpty()) finish(lastKnown)
    }
}
