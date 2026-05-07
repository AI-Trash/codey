package com.codey.app

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder

data class CodeyPairingLink(
    val baseUrl: String,
    val deviceCode: String,
    val userCode: String
) {
    fun approvalUrl(): String {
        var normalizedBaseUrl = baseUrl
        while (normalizedBaseUrl.endsWith("/")) {
            normalizedBaseUrl = normalizedBaseUrl.dropLast(1)
        }
        return "$normalizedBaseUrl/device?userCode=${urlEncode(userCode)}"
    }

    companion object {
        private const val SCHEME = "codey"
        private const val HOST = "pair"

        fun parse(value: String?): CodeyPairingLink {
            if (value.isNullOrBlank()) {
                throw Exception("Pairing link is empty.")
            }

            val uri = URI(value.trim())
            if (!SCHEME.equals(uri.scheme, ignoreCase = true) ||
                !HOST.equals(uri.host, ignoreCase = true)
            ) {
                throw Exception("QR code is not a Codey pairing link.")
            }

            val query = parseQuery(uri.rawQuery)
            val baseUrl = query["baseUrl"].trimOrEmpty()
            val deviceCode = query["deviceCode"].trimOrEmpty()
            val userCode = query["userCode"].trimOrEmpty()
            if (baseUrl.isEmpty() || deviceCode.isEmpty() || userCode.isEmpty()) {
                throw Exception("Pairing link is missing required fields.")
            }

            return CodeyPairingLink(baseUrl, deviceCode, userCode)
        }

        private fun parseQuery(rawQuery: String?): Map<String, String> {
            if (rawQuery.isNullOrBlank()) {
                return emptyMap()
            }

            return rawQuery.split("&").associate { pair ->
                val separator = pair.indexOf('=')
                val key = if (separator >= 0) pair.substring(0, separator) else pair
                val value = if (separator >= 0) pair.substring(separator + 1) else ""
                urlDecode(key) to urlDecode(value)
            }
        }

        private fun urlDecode(value: String): String {
            return URLDecoder.decode(value, "UTF-8")
        }

        private fun urlEncode(value: String): String {
            return try {
                URLEncoder.encode(value, "UTF-8")
            } catch (_: Exception) {
                value
            }
        }
    }
}
