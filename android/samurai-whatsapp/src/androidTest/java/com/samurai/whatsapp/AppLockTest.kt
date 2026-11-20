package com.samurai.whatsapp

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import android.content.Context
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AppLockTest {
    private val context: Context
        get() = ApplicationProvider.getApplicationContext()

    @Test
    fun lockPreferenceDefaultsToDisabledAndCanBeChanged() {
        AppLock.setEnabled(context, false)
        assertFalse(AppLock.isEnabled(context))

        AppLock.setEnabled(context, true)
        assertTrue(AppLock.isEnabled(context))

        AppLock.setEnabled(context, false)
        assertFalse(AppLock.isEnabled(context))
    }
}
