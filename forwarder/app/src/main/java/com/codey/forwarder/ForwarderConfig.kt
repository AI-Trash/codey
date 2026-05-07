package com.codey.app

import android.content.Context
import android.content.SharedPreferences
import android.provider.Settings
import org.json.JSONObject

object ForwarderConfig {
    const val DEFAULT_CODEY_BASE_URL = "http://10.0.2.2:3000"
    const val DEFAULT_WEBHOOK_URL = "http://10.0.2.2:3001/webhooks/codey-app/whatsapp"

    private const val PREFS_NAME = "codey_app"
    private const val KEY_CODEY_BASE_URL = "codey_base_url"
    private const val KEY_WEBHOOK_URL = "webhook_url"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_DEVICE_TOKEN = "device_token"
    private const val KEY_WHATSAPP_PHONE_NUMBER = "whatsapp_phone_number"
    private const val KEY_GOPAY_PHONE_NUMBER = "gopay_phone_number"
    private const val KEY_FORWARD_ENABLED = "forward_enabled"
    private const val KEY_FORWARD_BUSINESS = "forward_business"
    private const val KEY_PENDING_PAIRING_DEVICE_CODE = "pending_pairing_device_code"
    private const val KEY_PENDING_PAIRING_USER_CODE = "pending_pairing_user_code"
    private const val KEY_PENDING_PAIRING_APPROVAL_URL = "pending_pairing_approval_url"
    private const val KEY_LAST_STATUS = "last_status"
    private const val KEY_LAST_TITLE = "last_title"
    private const val KEY_LAST_BODY = "last_body"
    private const val KEY_LAST_AT = "last_at"

    fun readSettings(context: Context): ForwarderSettings {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return ForwarderSettings(
            codeyBaseUrl = readString(prefs, KEY_CODEY_BASE_URL, DEFAULT_CODEY_BASE_URL),
            webhookUrl = readString(prefs, KEY_WEBHOOK_URL, DEFAULT_WEBHOOK_URL),
            deviceId = readString(prefs, KEY_DEVICE_ID, defaultDeviceId(context)),
            deviceToken = readString(prefs, KEY_DEVICE_TOKEN, ""),
            whatsappPhoneNumber = readString(prefs, KEY_WHATSAPP_PHONE_NUMBER, ""),
            gopayPhoneNumber = readString(prefs, KEY_GOPAY_PHONE_NUMBER, ""),
            forwardEnabled = prefs.getBoolean(KEY_FORWARD_ENABLED, true),
            forwardBusiness = prefs.getBoolean(KEY_FORWARD_BUSINESS, true)
        )
    }

    fun saveSettings(context: Context, settings: ForwarderSettings) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_CODEY_BASE_URL, settings.codeyBaseUrl.trimOrEmpty())
            .putString(KEY_WEBHOOK_URL, settings.webhookUrl.trimOrEmpty())
            .putString(KEY_DEVICE_ID, settings.deviceId.trimOrEmpty())
            .putString(KEY_DEVICE_TOKEN, settings.deviceToken.trimOrEmpty())
            .putString(KEY_WHATSAPP_PHONE_NUMBER, settings.whatsappPhoneNumber.trimOrEmpty())
            .putString(KEY_GOPAY_PHONE_NUMBER, settings.gopayPhoneNumber.trimOrEmpty())
            .putBoolean(KEY_FORWARD_ENABLED, settings.forwardEnabled)
            .putBoolean(KEY_FORWARD_BUSINESS, settings.forwardBusiness)
            .apply()
    }

    fun saveDeviceToken(context: Context, deviceToken: String?) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_DEVICE_TOKEN, deviceToken.trimOrEmpty())
            .remove(KEY_PENDING_PAIRING_DEVICE_CODE)
            .remove(KEY_PENDING_PAIRING_USER_CODE)
            .remove(KEY_PENDING_PAIRING_APPROVAL_URL)
            .apply()
    }

    fun readPairingState(context: Context): PairingState {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return PairingState(
            deviceCode = readString(prefs, KEY_PENDING_PAIRING_DEVICE_CODE, ""),
            userCode = readString(prefs, KEY_PENDING_PAIRING_USER_CODE, ""),
            approvalUrl = readString(prefs, KEY_PENDING_PAIRING_APPROVAL_URL, "")
        )
    }

    fun savePairingState(
        context: Context,
        deviceCode: String?,
        userCode: String?,
        approvalUrl: String?
    ) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_PENDING_PAIRING_DEVICE_CODE, deviceCode.trimOrEmpty())
            .putString(KEY_PENDING_PAIRING_USER_CODE, userCode.trimOrEmpty())
            .putString(KEY_PENDING_PAIRING_APPROVAL_URL, approvalUrl.trimOrEmpty())
            .apply()
    }

    fun clearPairingState(context: Context) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_PENDING_PAIRING_DEVICE_CODE)
            .remove(KEY_PENDING_PAIRING_USER_CODE)
            .remove(KEY_PENDING_PAIRING_APPROVAL_URL)
            .apply()
    }

    fun readStatus(context: Context): ForwarderStatus {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return ForwarderStatus(
            message = prefs.getString(KEY_LAST_STATUS, "No notifications forwarded yet.")
                ?: "No notifications forwarded yet.",
            title = prefs.getString(KEY_LAST_TITLE, null),
            body = prefs.getString(KEY_LAST_BODY, null),
            at = prefs.getLong(KEY_LAST_AT, 0L)
        )
    }

    fun saveStatus(context: Context, message: String?) {
        saveStatus(context, message, null, null, System.currentTimeMillis())
    }

    fun saveStatus(context: Context, message: String?, title: String?, body: String?) {
        saveStatus(context, message, title, body, System.currentTimeMillis())
    }

    fun saveStatus(
        context: Context,
        message: String?,
        title: String?,
        body: String?,
        at: Long
    ) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_LAST_STATUS, message)
            .putString(KEY_LAST_TITLE, title)
            .putString(KEY_LAST_BODY, body)
            .putLong(KEY_LAST_AT, at)
            .apply()
    }

    fun putOptional(target: JSONObject, name: String, value: String?): JSONObject {
        if (!value.isNullOrBlank()) {
            try {
                target.put(name, value)
            } catch (_: Exception) {
            }
        }
        return target
    }

    private fun readString(prefs: SharedPreferences, key: String, fallback: String): String {
        val value = prefs.getString(key, null).trimOrEmpty()
        return value.ifEmpty { fallback }
    }

    private fun defaultDeviceId(context: Context): String {
        val androidId = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ANDROID_ID
        )
        val suffix = androidId.trimOrEmpty().ifEmpty { "unknown" }
        return "android-$suffix"
    }

    data class PairingState(
        val deviceCode: String,
        val userCode: String,
        val approvalUrl: String
    ) {
        fun hasPendingChallenge(): Boolean = deviceCode.trim().isNotEmpty()
    }
}
