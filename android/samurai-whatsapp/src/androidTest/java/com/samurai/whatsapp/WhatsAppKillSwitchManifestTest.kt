package com.samurai.whatsapp

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WhatsAppKillSwitchManifestTest {
    private val context: Context
        get() = ApplicationProvider.getApplicationContext()

    @Test
    fun vpnServiceIsSystemBoundAndAlwaysOnIsDisabled() {
        val service = context.packageManager.getServiceInfo(
            ComponentName(context, WhatsAppKillSwitchService::class.java),
            PackageManager.GET_META_DATA
        )
        assertTrue(service.exported)
        assertEquals("android.permission.BIND_VPN_SERVICE", service.permission)
        assertFalse(
            service.metaData?.getBoolean(
                VpnService.SERVICE_META_DATA_SUPPORTS_ALWAYS_ON,
                true
            ) ?: true
        )

        val vpnIntent = Intent(VpnService.SERVICE_INTERFACE).setPackage(context.packageName)
        val matches = context.packageManager.queryIntentServices(vpnIntent, 0)
        assertTrue(matches.any {
            it.serviceInfo.name == WhatsAppKillSwitchService::class.java.name
        })
    }

    @Test
    fun lifecycleTransitionsArePersisted() {
        WhatsAppKillSwitchService.setRequestedState(context, WhatsAppKillSwitchState.STARTING)
        assertEquals(WhatsAppKillSwitchState.STARTING, WhatsAppKillSwitchService.state(context))

        WhatsAppKillSwitchService.setRequestedState(context, WhatsAppKillSwitchState.FAILED)
        assertEquals(WhatsAppKillSwitchState.FAILED, WhatsAppKillSwitchService.state(context))
        assertFalse(WhatsAppKillSwitchService.isEnabled(context))
    }

    @Test
    fun staleStoppingStateResolvesToDisabledWhenNoTunnelIsActive() {
        WhatsAppKillSwitchService.setRequestedState(context, WhatsAppKillSwitchState.STOPPING)
        assertEquals(WhatsAppKillSwitchState.DISABLED, WhatsAppKillSwitchService.state(context))
    }

    @Test
    fun stalePersistedStateIsNotPresentedAsAnActiveVpn() {
        val prefs = context.getSharedPreferences(
            "samurai_whatsapp_kill_switch",
            Context.MODE_PRIVATE
        )
        prefs.edit()
            .putString("state", "ENABLED")
            .putBoolean("enabled", true)
            .commit()
        assertFalse(WhatsAppKillSwitchService.isEnabled(context))
        assertEquals(WhatsAppKillSwitchState.DISABLED, WhatsAppKillSwitchService.state(context))
        assertFalse(prefs.getBoolean("enabled", true))
    }
}
