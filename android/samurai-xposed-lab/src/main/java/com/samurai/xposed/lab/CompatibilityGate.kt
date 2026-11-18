package com.samurai.xposed.lab

/**
 * Exact host identity used by the isolated compatibility lab.
 *
 * A package-name match is not sufficient to activate a feature. A host version
 * must be explicitly verified against a locally supplied, authorized test APK
 * and a device acceptance record.
 */
data class HostIdentity(
    val packageName: String,
    val processName: String,
    val versionName: String?,
    val versionCode: Long
)

enum class CompatibilityDecision {
    UNSUPPORTED_PACKAGE,
    SECONDARY_PROCESS,
    VERSION_UNAVAILABLE,
    VERSION_UNVERIFIED,
    VERIFIED_FOR_LAB
}

object CompatibilityGate {
    val supportedPackages: Set<String> = setOf(
        "com.whatsapp",
        "com.whatsapp.w4b"
    )

    fun versionKey(versionName: String, versionCode: Long): String =
        "$versionName/$versionCode"

    fun evaluate(
        host: HostIdentity,
        verifiedVersions: Set<String>
    ): CompatibilityDecision {
        if (host.packageName !in supportedPackages) {
            return CompatibilityDecision.UNSUPPORTED_PACKAGE
        }

        // Only the exact main process is admitted. Isolated/secondary processes
        // remain inactive until they have their own reviewed acceptance record.
        if (host.processName != host.packageName) {
            return CompatibilityDecision.SECONDARY_PROCESS
        }

        val versionName = host.versionName?.trim().orEmpty()
        if (versionName.isEmpty() || host.versionCode <= 0L) {
            return CompatibilityDecision.VERSION_UNAVAILABLE
        }

        return if (versionKey(versionName, host.versionCode) in verifiedVersions) {
            CompatibilityDecision.VERIFIED_FOR_LAB
        } else {
            CompatibilityDecision.VERSION_UNVERIFIED
        }
    }
}

/**
 * The initial lab intentionally has no feature hooks. A verified host identity
 * only authorizes future feature-specific validation; it never enables hooks
 * by itself.
 */
object LabActivationPolicy {
    const val FEATURE_HOOKS_IMPLEMENTED: Boolean = false

    fun mayActivateFeatures(decision: CompatibilityDecision): Boolean =
        FEATURE_HOOKS_IMPLEMENTED &&
            decision == CompatibilityDecision.VERIFIED_FOR_LAB
}
