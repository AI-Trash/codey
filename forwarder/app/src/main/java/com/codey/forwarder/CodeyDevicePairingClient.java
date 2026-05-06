package com.codey.app;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class CodeyDevicePairingClient {
    private CodeyDevicePairingClient() {}

    static PairingChallenge startPairing(ForwarderSettings settings) throws Exception {
        JSONObject payload = new JSONObject()
            .put("kind", "MOBILE")
            .put("flowType", "codey-mobile-pairing")
            .put("cliName", settings.deviceId)
            .put("requestedBy", settings.deviceId)
            .put("scope", "mobile:pair mobile:whatsapp:ingest mobile:gopay:task");

        HttpResult result = postJson(buildUrl(settings.codeyBaseUrl, "/api/device"), payload, null);
        if (result.statusCode < 200 || result.statusCode > 299) {
            throw new Exception("Pairing start failed: HTTP " + result.statusCode + " " +
                take(result.responseBody, 180));
        }

        JSONObject response = new JSONObject(result.responseBody);
        return new PairingChallenge(
            response.getString("deviceCode"),
            response.getString("userCode"),
            response.optString("verificationUri", "/device"),
            response.optString("verificationUriComplete", ""),
            response.optString("expiresAt", "")
        );
    }

    static PairingResult completePairing(ForwarderSettings settings, String deviceCode)
        throws Exception {
        JSONObject payload = new JSONObject()
            .put("kind", "MOBILE")
            .put("deviceId", settings.deviceId)
            .put("label", settings.deviceId)
            .put("capabilities", new JSONArray()
                .put("whatsapp:ingest")
                .put("gopay:unlink"));

        JSONArray phoneBindings = new JSONArray();
        addPhoneBinding(phoneBindings, settings.whatsappPhoneNumber, "WHATSAPP", "WhatsApp", true);
        addPhoneBinding(phoneBindings, settings.gopayPhoneNumber, "GOPAY", "GoPay", false);
        payload.put("phoneBindings", phoneBindings);

        HttpResult result = postJson(
            buildUrl(settings.codeyBaseUrl, "/api/device/" + deviceCode),
            payload,
            null
        );
        if (result.statusCode < 200 || result.statusCode > 299) {
            throw new Exception("Pairing completion failed: HTTP " + result.statusCode + " " +
                take(result.responseBody, 180));
        }

        JSONObject response = new JSONObject(result.responseBody);
        JSONObject device = response.getJSONObject("device");
        return new PairingResult(
            response.getString("deviceToken"),
            device.getString("id"),
            device.getString("deviceId")
        );
    }

    private static void addPhoneBinding(
        JSONArray bindings,
        String phoneNumber,
        String purpose,
        String label,
        boolean isDefault
    ) throws Exception {
        String normalized = phoneNumber == null ? "" : phoneNumber.trim();
        if (normalized.isEmpty()) {
            return;
        }

        bindings.put(new JSONObject()
            .put("phoneNumber", normalized)
            .put("purpose", purpose)
            .put("label", label)
            .put("isDefault", isDefault));
    }

    private static HttpResult postJson(String url, JSONObject payload, String bearerToken)
        throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(10_000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setRequestProperty("Accept", "application/json");
        if (bearerToken != null && !bearerToken.trim().isEmpty()) {
            connection.setRequestProperty("Authorization", "Bearer " + bearerToken.trim());
        }

        try (OutputStreamWriter writer = new OutputStreamWriter(
            connection.getOutputStream(),
            StandardCharsets.UTF_8
        )) {
            writer.write(payload.toString());
        }

        int statusCode = connection.getResponseCode();
        InputStream stream = statusCode >= 200 && statusCode <= 299
            ? connection.getInputStream()
            : connection.getErrorStream();
        String responseBody = readStream(stream);
        connection.disconnect();
        return new HttpResult(statusCode, responseBody);
    }

    private static String buildUrl(String baseUrl, String path) {
        String normalizedBase = baseUrl == null || baseUrl.trim().isEmpty()
            ? ForwarderConfig.DEFAULT_CODEY_BASE_URL
            : baseUrl.trim();
        while (normalizedBase.endsWith("/")) {
            normalizedBase = normalizedBase.substring(0, normalizedBase.length() - 1);
        }
        return normalizedBase + path;
    }

    private static String readStream(InputStream stream) throws Exception {
        if (stream == null) {
            return "";
        }

        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static String take(String value, int length) {
        if (value == null) {
            return "";
        }
        return value.length() <= length ? value : value.substring(0, length);
    }

    static final class PairingChallenge {
        final String deviceCode;
        final String userCode;
        final String verificationUri;
        final String verificationUriComplete;
        final String expiresAt;

        PairingChallenge(
            String deviceCode,
            String userCode,
            String verificationUri,
            String verificationUriComplete,
            String expiresAt
        ) {
            this.deviceCode = deviceCode;
            this.userCode = userCode;
            this.verificationUri = verificationUri;
            this.verificationUriComplete = verificationUriComplete;
            this.expiresAt = expiresAt;
        }
    }

    static final class PairingResult {
        final String deviceToken;
        final String mobileDeviceId;
        final String deviceId;

        PairingResult(String deviceToken, String mobileDeviceId, String deviceId) {
            this.deviceToken = deviceToken;
            this.mobileDeviceId = mobileDeviceId;
            this.deviceId = deviceId;
        }
    }

    private static final class HttpResult {
        final int statusCode;
        final String responseBody;

        HttpResult(int statusCode, String responseBody) {
            this.statusCode = statusCode;
            this.responseBody = responseBody;
        }
    }
}
