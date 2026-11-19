package com.samurai.xposed.lab

import android.app.Application
import android.content.Context
import android.content.pm.PackageInfo
import android.os.Build
import de.robv.android.xposed.IXposedHookLoadPackage
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import de.robv.android.xposed.XposedHelpers
import de.robv.android.xposed.callbacks.XC_LoadPackage

/**
 * Non-mutating Xposed entry point.
 *
 * Waits for Application.attach(Context) to obtain a real package context. It
 * records only package/process/version metadata. It does not inspect chats,
 * message content, contacts, media, notifications or credentials and does not
 * hook message, receipt, presence or View Once methods.
 */
class SamuraiXposedEntry : IXposedHookLoadPackage {
    override fun handleLoadPackage(lpparam: XC_LoadPackage.LoadPackageParam) {
        if (lpparam.packageName !in CompatibilityGate.supportedPackages) return

        if (lpparam.processName != lpparam.packageName) {
            logDecision(
                HostIdentity(
                    packageName = lpparam.packageName,
                    processName = lpparam.processName ?: "",
                    versionName = null,
                    versionCode = 0L
                ),
                CompatibilityDecision.SECONDARY_PROCESS
            )
            return
        }

        runCatching {
            XposedHelpers.findAndHookMethod(
                Application::class.java,
                "attach",
                Context::class.java,
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) {
                        val context = param.args?.firstOrNull() as? Context ?: return
                        val identity = readHostIdentity(context, lpparam)
                        val decision = CompatibilityGate.evaluate(identity, emptySet())
                        logDecision(identity, decision)
                    }
                }
            )
        }.onFailure { error ->
            XposedBridge.log(
                "[SAMURAI-XPOSED-LAB] diagnostic hook registration failed: " +
                    error.javaClass.simpleName
            )
        }
    }

    private fun readHostIdentity(
        context: Context,
        lpparam: XC_LoadPackage.LoadPackageParam
    ): HostIdentity {
        val info = readPackageInfo(context, lpparam.packageName)
        val versionCode = info?.let {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                it.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                it.versionCode.toLong()
            }
        } ?: 0L

        return HostIdentity(
            packageName = context.packageName,
            processName = lpparam.processName ?: "",
            versionName = info?.versionName,
            versionCode = versionCode
        )
    }

    private fun readPackageInfo(context: Context, packageName: String): PackageInfo? =
        runCatching {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(packageName, 0)
        }.getOrNull()

    private fun logDecision(identity: HostIdentity, decision: CompatibilityDecision) {
        XposedBridge.log(
            "[SAMURAI-XPOSED-LAB] diagnostic-only " +
                "package=${identity.packageName} " +
                "process=${identity.processName} " +
                "version=${identity.versionName ?: "unknown"} " +
                "versionCode=${identity.versionCode} " +
                "decision=$decision hooks=DISABLED"
        )
    }
}
