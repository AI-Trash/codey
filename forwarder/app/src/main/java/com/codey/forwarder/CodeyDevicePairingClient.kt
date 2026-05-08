package com.codey.app

import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

object CodeyDevicePairingClient {
    fun startPairing(settings: ForwarderSettings): PairingChallenge {
        val payload = JSONObject()
            .put("kind", "MOBILE")
            .put("flowType", "codey-mobile-pairing")
            .put("cliName", settings.deviceId)
            .put("requestedBy", settings.deviceId)
            .put("scope", "mobile:pair mobile:whatsapp:ingest mobile:gopay:task")

        val result = postJson(buildUrl(settings.codeyBaseUrl, "/api/device"), payload)
        if (result.statusCode !in 200..299) {
            throw Exception(
                "Pairing start failed: HTTP ${result.statusCode} ${result.responseBody.takeAtMost(180)}"
            )
        }

        val response = JSONObject(result.responseBody)
        val baseUrl = normalizeBaseUrl(settings.codeyBaseUrl)
        val verificationUri = response.optString("verificationUri", "/device")
        val verificationUriComplete = response.optString("verificationUriComplete", "")
        return PairingChallenge(
            deviceCode = response.getString("deviceCode"),
            userCode = response.getString("userCode"),
            verificationUri = toAbsoluteUrl(baseUrl, verificationUri),
            verificationUriComplete = toAbsoluteUrl(baseUrl, verificationUriComplete),
            expiresAt = response.optString("expiresAt", "")
        )
    }

    fun completePairing(settings: ForwarderSettings, deviceCode: String): PairingResult {
        val payload = JSONObject()
            .put("kind", "MOBILE")
            .put("deviceId", settings.deviceId)
            .put("label", settings.deviceId)
            .put(
                "capabilities",
                JSONArray()
                    .put("whatsapp:ingest")
                    .put("gopay:unlink")
            )

        val phoneBindings = JSONArray()
        addPhoneBinding(phoneBindings, settings.whatsappPhoneNumber, "WHATSAPP", "WhatsApp", true)
        addPhoneBinding(phoneBindings, settings.gopayPhoneNumber, "GOPAY", "GoPay", false)
        payload.put("phoneBindings", phoneBindings)

        val result = postJson(buildUrl(settings.codeyBaseUrl, "/api/device/$deviceCode"), payload)
        if (result.statusCode !in 200..299) {
            throw Exception(
                "Pairing completion failed: HTTP ${result.statusCode} ${result.responseBody.takeAtMost(180)}"
            )
        }

        val response = JSONObject(result.responseBody)
        val device = response.getJSONObject("device")
        return PairingResult(
            deviceToken = response.getString("deviceToken"),
            mobileDeviceId = device.getString("id"),
            deviceId = device.getString("deviceId")
        )
    }

    private fun addPhoneBinding(
        bindings: JSONArray,
        phoneNumber: String?,
        purpose: String,
        label: String,
        isDefault: Boolean
    ) {
        val normalized = phoneNumber?.trim().orEmpty()
        if (normalized.isEmpty()) {
            return
        }

        bindings.put(
            JSONObject()
                .put("phoneNumber", normalized)
                .put("purpose", purpose)
                .put("label", label)
                .put("isDefault", isDefault)
        )
    }

    private fun postJson(
        url: String,
        payload: JSONObject,
        bearerToken: String? = null
    ): HttpResult {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.connectTimeout = 10_000
        connection.readTimeout = 10_000
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        connection.setRequestProperty("Accept", "application/json")
        if (!bearerToken.isNullOrBlank()) {
            connection.setRequestProperty("Authorization", "Bearer ${bearerToken.trim()}")
        }

        OutputStreamWriter(connection.outputStream, StandardCharsets.UTF_8).use { writer ->
            writer.write(payload.toString())
        }

        val statusCode = connection.responseCode
        val stream = if (statusCode in 200..299) {
            connection.inputStream
        } else {
            connection.errorStream
        }
        val responseBody = readStream(stream)
        connection.disconnect()
        return HttpResult(statusCode, responseBody)
    }

    private fun buildUrl(baseUrl: String?, path: String): String {
        return normalizeBaseUrl(baseUrl) + path
    }

    private fun normalizeBaseUrl(baseUrl: String?): String {
        var normalizedBase = if (baseUrl.isNullOrBlank()) {
            ForwarderConfig.DEFAULT_CODEY_BASE_URL
        } else {
            baseUrl.trim()
        }
        while (normalizedBase.endsWith("/")) {
            normalizedBase = normalizedBase.dropLast(1)
        }
        return normalizedBase
    }

    private fun toAbsoluteUrl(baseUrl: String, value: String): String {
        val trimmed = value.trim()
        if (trimmed.isEmpty()) {
            return ""
        }
        if (
            trimmed.startsWith("http://", ignoreCase = true) ||
            trimmed.startsWith("https://", ignoreCase = true)
        ) {
            return trimmed
        }
        return if (trimmed.startsWith("/")) {
            baseUrl + trimmed
        } else {
            "$baseUrl/$trimmed"
        }
    }

    internal fun normalizeVerificationUrl(baseUrl: String?, value: String): String {
        return toAbsoluteUrl(normalizeBaseUrl(baseUrl), value)
    }

    private fun readStream(stream: InputStream?): String {
        return stream?.use { input ->
            input.readBytes().toString(StandardCharsets.UTF_8)
        }.orEmpty()
    }

    data class PairingChallenge(
        val deviceCode: String,
        val userCode: String,
        val verificationUri: String,
        val verificationUriComplete: String,
        val expiresAt: String
    )

    data class PairingResult(
        val deviceToken: String,
        val mobileDeviceId: String,
        val deviceId: String
    )

    private data class HttpResult(
        val statusCode: Int,
        val responseBody: String
    )
}
