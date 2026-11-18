package com.samurai.xposed.lab

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CompatibilityGateTest {
    @Test
    fun acceptsOnlyExactWhatsAppPackageNames() {
        val allowed = HostIdentity("com.whatsapp", "com.whatsapp", "2.26.46.1", 260460001L)
        val clone = HostIdentity("com.fake.whatsapp", "com.fake.whatsapp", "2.26.46.1", 260460001L)

        assertEquals(
            CompatibilityDecision.VERSION_UNVERIFIED,
            CompatibilityGate.evaluate(allowed, emptySet())
        )
        assertEquals(
            CompatibilityDecision.UNSUPPORTED_PACKAGE,
            CompatibilityGate.evaluate(clone, setOf("2.26.46.1/260460001"))
        )
    }

    @Test
    fun requiresExactMainProcess() {
        val host = HostIdentity(
            packageName = "com.whatsapp",
            processName = "com.whatsapp:secondary",
            versionName = "2.26.46.1",
            versionCode = 260460001L
        )

        assertEquals(
            CompatibilityDecision.SECONDARY_PROCESS,
            CompatibilityGate.evaluate(host, setOf("2.26.46.1/260460001"))
        )
    }

    @Test
    fun requiresVersionNameAndPositiveVersionCode() {
        val missingName = HostIdentity("com.whatsapp", "com.whatsapp", null, 260460001L)
        val missingCode = HostIdentity("com.whatsapp", "com.whatsapp", "2.26.46.1", 0L)

        assertEquals(
            CompatibilityDecision.VERSION_UNAVAILABLE,
            CompatibilityGate.evaluate(missingName, emptySet())
        )
        assertEquals(
            CompatibilityDecision.VERSION_UNAVAILABLE,
            CompatibilityGate.evaluate(missingCode, emptySet())
        )
    }

    @Test
    fun requiresExactVerifiedVersionTuple() {
        val host = HostIdentity("com.whatsapp", "com.whatsapp", "2.26.46.1", 260460001L)

        assertEquals(
            CompatibilityDecision.VERSION_UNVERIFIED,
            CompatibilityGate.evaluate(host, setOf("2.26.46.1/260460000"))
        )
        assertEquals(
            CompatibilityDecision.VERIFIED_FOR_LAB,
            CompatibilityGate.evaluate(host, setOf("2.26.46.1/260460001"))
        )
    }

    @Test
    fun verifiedVersionDoesNotEnableUnimplementedHooks() {
        assertFalse(LabActivationPolicy.FEATURE_HOOKS_IMPLEMENTED)
        assertFalse(
            LabActivationPolicy.mayActivateFeatures(
                CompatibilityDecision.VERIFIED_FOR_LAB
            )
        )
    }

    @Test
    fun supportsWhatsAppBusinessOnlyByItsExactPackageName() {
        val business = HostIdentity(
            "com.whatsapp.w4b",
            "com.whatsapp.w4b",
            "2.26.46.1",
            260460001L
        )
        assertEquals(
            CompatibilityDecision.VERSION_UNVERIFIED,
            CompatibilityGate.evaluate(business, emptySet())
        )
    }
}
