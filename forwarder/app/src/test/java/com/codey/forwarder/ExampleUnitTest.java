package com.codey.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.fail;

import org.junit.Test;

public class ExampleUnitTest {
    @Test
    public void additionIsCorrect() {
        assertEquals(4, 2 + 2);
    }

    @Test
    public void parsesCodeyPairingLinks() throws Exception {
        CodeyPairingLink link = CodeyPairingLink.parse(
            "codey://pair?v=1&baseUrl=http%3A%2F%2F10.0.2.2%3A3000&deviceCode=device-123&userCode=ABCD-EFGH"
        );

        assertEquals("http://10.0.2.2:3000", link.baseUrl);
        assertEquals("device-123", link.deviceCode);
        assertEquals("ABCD-EFGH", link.userCode);
        assertEquals(
            "http://10.0.2.2:3000/device?userCode=ABCD-EFGH",
            link.approvalUrl()
        );
    }

    @Test
    public void rejectsNonCodeyPairingLinks() {
        try {
            CodeyPairingLink.parse("https://example.com/device?userCode=ABCD-EFGH");
            fail("Expected parse to reject non-Codey links.");
        } catch (Exception expected) {
            assertEquals("QR code is not a Codey pairing link.", expected.getMessage());
        }
    }
}
