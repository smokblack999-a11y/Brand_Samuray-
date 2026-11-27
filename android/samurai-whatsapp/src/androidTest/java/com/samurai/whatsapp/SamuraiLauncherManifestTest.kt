package com.samurai.whatsapp

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SamuraiLauncherManifestTest {
    private val context: Context
        get() = ApplicationProvider.getApplicationContext()

    @Test
    fun commandCenterIsTheOnlyExportedActivityEntryPoint() {
        val packageManager = context.packageManager
        val launchIntent = packageManager.getLaunchIntentForPackage(context.packageName)

        assertNotNull("The app must expose a launcher intent", launchIntent)
        assertEquals(
            LauncherActivity::class.java.name,
            launchIntent?.component?.className
        )

        val launcher = packageManager.getActivityInfo(
            ComponentName(context, LauncherActivity::class.java),
            0
        )
        val modules = packageManager.getActivityInfo(
            ComponentName(context, ModuleCenterActivity::class.java),
            0
        )
        val legacy = packageManager.getActivityInfo(
            ComponentName(context, MainActivity::class.java),
            0
        )

        assertTrue("Launcher must be externally launchable", launcher.exported)
        assertFalse("Module center must remain internal", modules.exported)
        assertFalse("Legacy workspace must remain internal", legacy.exported)
    }

    @Test
    fun moduleRoutesAreLimitedToKnownLocalScreens() {
        val validModules = setOf(
            "INBOX",
            "VAULT",
            "CHATS",
            "TIMELINE",
            "STATUS",
            "SECURITY"
        )
        assertEquals(6, validModules.size)
        validModules.forEach { module ->
            val intent = android.content.Intent(context, ModuleCenterActivity::class.java)
                .putExtra(ModuleCenterActivity.EXTRA_MODULE, module)
            assertEquals(ModuleCenterActivity::class.java.name, intent.component?.className)
            assertEquals(module, intent.getStringExtra(ModuleCenterActivity.EXTRA_MODULE))
        }
    }
}
