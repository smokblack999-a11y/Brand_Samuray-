package com.samurai.whatsapp

import android.content.Context
import android.content.Intent
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SamuraiModuleSmokeTest {
    private val context: Context
        get() = ApplicationProvider.getApplicationContext()

    @Before
    fun disableAppLockForNavigationTests() {
        AppLock.setEnabled(context, false)
    }

    @Test
    fun launcherRendersCommandCenterAndAnimatedCore() {
        val scenario = ActivityScenario.launch(LauncherActivity::class.java)
        try {
            scenario.onActivity { activity ->
                val content = activity.findViewById<ViewGroup>(android.R.id.content)
                assertNotNull(content)
                assertTrue("Dashboard heading should be visible",
                    containsText(content, "CONTROL"))
                assertTrue("Animated SAMURAI core should be attached",
                    containsView<SamuraiCoreView>(content))
                assertTrue("Inbox route should be present",
                    containsText(content, "MESSAGE INTELLIGENCE"))
            }
        } finally {
            scenario.close()
        }
    }

    @Test
    fun allSixModuleRoutesRenderTheirOwnScreens() {
        val routes = listOf(
            "INBOX" to "MESSAGE INTELLIGENCE",
            "VAULT" to "PRIVATE MEDIA VAULT",
            "CHATS" to "CHAT IMPORT ARCHIVE",
            "TIMELINE" to "EVIDENCE TIMELINE",
            "STATUS" to "STATUS SAVER",
            "SECURITY" to "SECURITY CENTER"
        )

        routes.forEach { (route, expectedTitle) ->
            val intent = Intent(context, ModuleCenterActivity::class.java)
                .putExtra(ModuleCenterActivity.EXTRA_MODULE, route)
            val scenario = ActivityScenario.launch<ModuleCenterActivity>(intent)
            try {
                scenario.onActivity { activity ->
                    val content = activity.findViewById<ViewGroup>(android.R.id.content)
                    assertNotNull(content)
                    assertTrue(
                        "Route $route must render '$expectedTitle'",
                        containsText(content, expectedTitle)
                    )
                }
            } finally {
                scenario.close()
            }
        }
    }

    private fun containsText(view: View, expected: String): Boolean {
        if (view is TextView && view.text?.toString()?.contains(expected) == true) return true
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) {
                if (containsText(view.getChildAt(index), expected)) return true
            }
        }
        return false
    }

    private inline fun <reified T : View> containsView(view: View): Boolean {
        if (view is T) return true
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) {
                if (containsView<T>(view.getChildAt(index))) return true
            }
        }
        return false
    }
}
