package com.samurai.xposed.lab

import android.app.Application
import android.content.pm.PackageInfo
import android.os.Build
import de.robv.android.xposed.IXposedHookLoadPackage
import de.robv.android.xposed.XposedBridge
import de.robv.android.xposed.callbacks.XC_LoadPackage
import de.robv.android.xposed.AndroidAppHelper

/**
 * Non-mutating Xposed entry point.
 *
 * It records only the exact target package, process name and installed version.
 * It does not inspect chats, message content, contacts, media or credentials;
 * it does not hook or alter message/receipt/presence methods.
 */
class SamuraiXposedEntry : IXposedHookLoadPackage {
    override fun handleLoadPackage(lpparam: XC_LoadPackage.LoadPackageParam) {
        if (lpparam.packageName !in CompatibilityGate.supportedPackages) return

        val app = AndroidAppHelper.currentApplication()
        val packageInfo = app?.let { readPackageInfo(it as Application, lpparam.packageName) }
        val versionName = packageInfo?.versionName
        val versionCode = packageInfo?.let { info ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                info.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                info.versionCode.toLong()
            }
        } ?: 0L

        val identity = HostIdentity(
            packageName = lpparam.packageName,
            processName = lpparam.processName ?: "",
            versionName = versionName,
            versionCode = versionCode
        )
        val decision = CompatibilityGate.evaluate(identity, emptySet())

        XposedBridge.log(
            "[SAMURAI-XPOSED-LAB] diagnostic-only " +
                "package=${identity.packageName} " +
                "process=${identity.processName} " +
                "version=${identity.versionName ?: "unknown"} " +
                "versionCode=${identity.versionCode} " +
                "decision=$decision hooks=DISABLED"
        )
    }

    private fun readPackageInfo(app: Application, packageName: String): PackageInfo? =
        runCatching {
            @Suppress("DEPRECATION")
            app.packageManager.getPackageInfo(packageName, 0)
        }.getOrNull()
}
