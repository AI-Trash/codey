package com.codey.forwarder;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.StatusBarNotification;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class ForwarderNotifier {
    private static final String WHATSAPP_PACKAGE = "com.whatsapp";
    private static final String WHATSAPP_BUSINESS_PACKAGE = "com.whatsapp.w4b";

    private ForwarderNotifier() {}

    static boolean shouldForwardPackage(String packageName, boolean forwardBusiness) {
        return WHATSAPP_PACKAGE.equals(packageName) ||
            (forwardBusiness && WHATSAPP_BUSINESS_PACKAGE.equals(packageName));
    }

    static ForwardedNotification buildForwardedNotification(StatusBarNotification sbn) {
        Bundle extras = sbn.getNotification().extras;
        String title = readCharSequence(extras, Notification.EXTRA_TITLE);
        String text = readCharSequence(extras, Notification.EXTRA_TEXT);
        String bigText = readCharSequence(extras, Notification.EXTRA_BIG_TEXT);
        String subText = readCharSequence(extras, Notification.EXTRA_SUB_TEXT);
        String conversationTitle = readCharSequence(extras, Notification.EXTRA_CONVERSATION_TITLE);
        String body = bigText != null ? bigText : text;
        long receivedAt = sbn.getPostTime() > 0L ? sbn.getPostTime() : System.currentTimeMillis();
        String key = sbn.getKey();
        String notificationId = key != null
            ? key
            : sbn.getPackageName() + ":" + sbn.getId() + ":" + receivedAt;

        return new ForwardedNotification(
            sbn.getPackageName(),
            notificationId,
            title,
            body,
            text,
            bigText,
            subText,
            conversationTitle,
            receivedAt
        );
    }

    static JSONObject buildForwarderPayload(
        ForwarderSettings settings,
        ForwardedNotification notification
    ) throws Exception {
        JSONObject rawPayload = new JSONObject()
            .put("source", "codey-forwarder")
            .put("packageName", notification.packageName)
            .put("notificationId", notification.notificationId)
            .put("postTime", notification.receivedAt);
        ForwarderConfig.putOptional(rawPayload, "android.text", notification.text);
        ForwarderConfig.putOptional(rawPayload, "android.bigText", notification.bigText);
        ForwarderConfig.putOptional(rawPayload, "android.subText", notification.subText);
        ForwarderConfig.putOptional(
            rawPayload,
            "android.conversationTitle",
            notification.conversationTitle
        );

        JSONObject payload = new JSONObject()
            .put("source", "codey-forwarder")
            .put("deviceId", settings.deviceId)
            .put("packageName", notification.packageName)
            .put("notificationId", notification.notificationId)
            .put("receivedAt", notification.receivedAt)
            .put("rawPayload", rawPayload);
        ForwarderConfig.putOptional(payload, "sender", notification.title);
        ForwarderConfig.putOptional(
            payload,
            "chatName",
            notification.conversationTitle != null
                ? notification.conversationTitle
                : notification.title
        );
        ForwarderConfig.putOptional(payload, "title", notification.title);
        ForwarderConfig.putOptional(payload, "body", notification.body);
        return payload;
    }

    static HttpResult postNotificationPayload(String webhookUrl, JSONObject payload)
        throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(webhookUrl).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(10_000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setRequestProperty("Accept", "application/json");

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

    private static String readCharSequence(Bundle extras, String key) {
        CharSequence value = extras.getCharSequence(key);
        return value == null ? null : value.toString();
    }

    static final class HttpResult {
        final int statusCode;
        final String responseBody;

        HttpResult(int statusCode, String responseBody) {
            this.statusCode = statusCode;
            this.responseBody = responseBody;
        }
    }
}
