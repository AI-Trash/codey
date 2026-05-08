package com.codey.app

import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class ExampleUnitTest {
    @Test
    fun additionIsCorrect() {
        assertEquals(4, 2 + 2)
    }

    @Test
    fun parsesCodeyPairingLinks() {
        val link = CodeyPairingLink.parse(
            "codey://pair?v=1&baseUrl=http%3A%2F%2F10.0.2.2%3A3000&deviceCode=device-123&userCode=ABCD-EFGH"
        )

        assertEquals("http://10.0.2.2:3000", link.baseUrl)
        assertEquals("device-123", link.deviceCode)
        assertEquals("ABCD-EFGH", link.userCode)
        assertEquals(
            "http://10.0.2.2:3000/device?userCode=ABCD-EFGH",
            link.approvalUrl()
        )
    }

    @Test
    fun rejectsNonCodeyPairingLinks() {
        try {
            CodeyPairingLink.parse("https://example.com/device?userCode=ABCD-EFGH")
            fail("Expected parse to reject non-Codey links.")
        } catch (expected: Exception) {
            assertEquals("QR code is not a Codey pairing link.", expected.message)
        }
    }

    @Test
    fun normalizesRelativeApprovalUrls() {
        assertEquals(
            "https://codey.example/device",
            CodeyDevicePairingClient.normalizeVerificationUrl(
                "https://codey.example/",
                "/device"
            )
        )

        assertEquals(
            "https://codey.example/device?userCode=ABCD-EFGH",
            CodeyDevicePairingClient.normalizeVerificationUrl(
                "https://codey.example/",
                "/device?userCode=ABCD-EFGH"
            )
        )

        assertEquals(
            "https://other.example/device?userCode=ABCD-EFGH",
            CodeyDevicePairingClient.normalizeVerificationUrl(
                "https://codey.example/",
                "https://other.example/device?userCode=ABCD-EFGH"
            )
        )
    }
}
