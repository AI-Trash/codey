package com.codey.forwarder;

import android.content.Context;
import android.content.SharedPreferences;
import android.provider.Settings;

import org.json.JSONObject;

final class ForwarderConfig {
    static final String DEFAULT_WEBHOOK_URL =
        "http://10.0.2.2:3001/webhooks/forwarder/whatsapp";

    private static final String PREFS_NAME = "codey_forwarder";
    private static final String KEY_WEBHOOK_URL = "webhook_url";
    private static final String KEY_DEVICE_ID = "device_id";
    private static final String KEY_FORWARD_ENABLED = "forward_enabled";
    private static final String KEY_FORWARD_BUSINESS = "forward_business";
    private static final String KEY_LAST_STATUS = "last_status";
    private static final String KEY_LAST_TITLE = "last_title";
    private static final String KEY_LAST_BODY = "last_body";
    private static final String KEY_LAST_AT = "last_at";

    private ForwarderConfig() {}

    static ForwarderSettings readSettings(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return new ForwarderSettings(
            readString(prefs, KEY_WEBHOOK_URL, DEFAULT_WEBHOOK_URL),
            readString(prefs, KEY_DEVICE_ID, defaultDeviceId(context)),
            prefs.getBoolean(KEY_FORWARD_ENABLED, true),
            prefs.getBoolean(KEY_FORWARD_BUSINESS, true)
        );
    }

    static void saveSettings(Context context, ForwarderSettings settings) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_WEBHOOK_URL, trim(settings.webhookUrl))
            .putString(KEY_DEVICE_ID, trim(settings.deviceId))
            .putBoolean(KEY_FORWARD_ENABLED, settings.forwardEnabled)
            .putBoolean(KEY_FORWARD_BUSINESS, settings.forwardBusiness)
            .apply();
    }

    static ForwarderStatus readStatus(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return new ForwarderStatus(
            prefs.getString(KEY_LAST_STATUS, "No notifications forwarded yet."),
            prefs.getString(KEY_LAST_TITLE, null),
            prefs.getString(KEY_LAST_BODY, null),
            prefs.getLong(KEY_LAST_AT, 0L)
        );
    }

    static void saveStatus(Context context, String message) {
        saveStatus(context, message, null, null, System.currentTimeMillis());
    }

    static void saveStatus(Context context, String message, String title, String body) {
        saveStatus(context, message, title, body, System.currentTimeMillis());
    }

    static void saveStatus(
        Context context,
        String message,
        String title,
        String body,
        long at
    ) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_LAST_STATUS, message)
            .putString(KEY_LAST_TITLE, title)
            .putString(KEY_LAST_BODY, body)
            .putLong(KEY_LAST_AT, at)
            .apply();
    }

    static JSONObject putOptional(JSONObject object, String name, String value) {
        if (value != null && !value.trim().isEmpty()) {
            try {
                object.put(name, value);
            } catch (Exception ignored) {
            }
        }
        return object;
    }

    private static String readString(SharedPreferences prefs, String key, String fallback) {
        String value = trim(prefs.getString(key, null));
        return value.isEmpty() ? fallback : value;
    }

    private static String defaultDeviceId(Context context) {
        String androidId = Settings.Secure.getString(
            context.getContentResolver(),
            Settings.Secure.ANDROID_ID
        );
        String suffix = trim(androidId).isEmpty() ? "unknown" : trim(androidId);
        return "android-" + suffix;
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }
}
