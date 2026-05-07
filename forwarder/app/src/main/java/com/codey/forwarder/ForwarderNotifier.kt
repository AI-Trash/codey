package com.codey.app

import android.app.Notification
import android.os.Bundle
import android.service.notification.StatusBarNotification
import org.json.JSONObject
import java.io.InputStream
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

object ForwarderNotifier {
    private const val WHATSAPP_PACKAGE = "com.whatsapp"
    private const val WHATSAPP_BUSINESS_PACKAGE = "com.whatsapp.w4b"

    fun shouldForwardPackage(packageName: String?, forwardBusiness: Boolean): Boolean {
        return WHATSAPP_PACKAGE == packageName ||
            (forwardBusiness && WHATSAPP_BUSINESS_PACKAGE == packageName)
    }

    fun buildForwardedNotification(sbn: StatusBarNotification): ForwardedNotification {
        val extras = sbn.notification.extras
        val title = readCharSequence(extras, Notification.EXTRA_TITLE)
        val text = readCharSequence(extras, Notification.EXTRA_TEXT)
        val bigText = readCharSequence(extras, Notification.EXTRA_BIG_TEXT)
        val subText = readCharSequence(extras, Notification.EXTRA_SUB_TEXT)
        val conversationTitle = readCharSequence(extras, Notification.EXTRA_CONVERSATION_TITLE)
        val body = bigText ?: text
        val receivedAt = if (sbn.postTime > 0L) sbn.postTime else System.currentTimeMillis()
        val notificationId = sbn.key ?: "${sbn.packageName}:${sbn.id}:$receivedAt"

        return ForwardedNotification(
            packageName = sbn.packageName,
            notificationId = notificationId,
            title = title,
            body = body,
            text = text,
            bigText = bigText,
            subText = subText,
            conversationTitle = conversationTitle,
            receivedAt = receivedAt
        )
    }

    fun buildForwarderPayload(
        settings: ForwarderSettings,
        notification: ForwardedNotification
    ): JSONObject {
        val rawPayload = JSONObject()
            .put("source", "codey-app")
            .put("packageName", notification.packageName)
            .put("notificationId", notification.notificationId)
            .put("postTime", notification.receivedAt)
        ForwarderConfig.putOptional(rawPayload, "android.text", notification.text)
        ForwarderConfig.putOptional(rawPayload, "android.bigText", notification.bigText)
        ForwarderConfig.putOptional(rawPayload, "android.subText", notification.subText)
        ForwarderConfig.putOptional(
            rawPayload,
            "android.conversationTitle",
            notification.conversationTitle
        )

        val payload = JSONObject()
            .put("source", "codey-app")
            .put("deviceId", settings.deviceId)
            .put("packageName", notification.packageName)
            .put("notificationId", notification.notificationId)
            .put("receivedAt", notification.receivedAt)
            .put("rawPayload", rawPayload)
        ForwarderConfig.putOptional(payload, "sender", notification.title)
        ForwarderConfig.putOptional(
            payload,
            "chatName",
            notification.conversationTitle ?: notification.title
        )
        ForwarderConfig.putOptional(payload, "title", notification.title)
        ForwarderConfig.putOptional(payload, "body", notification.body)
        return payload
    }

    fun postNotificationPayload(
        webhookUrl: String,
        payload: JSONObject,
        bearerToken: String? = null
    ): HttpResult {
        val connection = URL(webhookUrl).openConnection() as HttpURLConnection
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

    fun buildCodeyWebIngestUrl(settings: ForwarderSettings): String {
        var baseUrl = settings.codeyBaseUrl.trim()
        if (baseUrl.isEmpty()) {
            return settings.webhookUrl
        }
        while (baseUrl.endsWith("/")) {
            baseUrl = baseUrl.dropLast(1)
        }
        return "$baseUrl/api/ingest/whatsapp-notification"
    }

    fun resolveNotificationWebhookUrl(settings: ForwarderSettings): String {
        return if (settings.deviceToken.trim().isEmpty()) {
            settings.webhookUrl
        } else {
            buildCodeyWebIngestUrl(settings)
        }
    }

    private fun readStream(stream: InputStream?): String {
        return stream?.use { input ->
            input.readBytes().toString(StandardCharsets.UTF_8)
        }.orEmpty()
    }

    private fun readCharSequence(extras: Bundle, key: String): String? {
        return extras.getCharSequence(key)?.toString()
    }

    data class HttpResult(
        val statusCode: Int,
        val responseBody: String
    )
}
