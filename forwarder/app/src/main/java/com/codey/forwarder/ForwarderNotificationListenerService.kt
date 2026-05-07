package com.codey.app

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class ForwarderNotificationListenerService : NotificationListenerService() {
    override fun onListenerConnected() {
        super.onListenerConnected()
        ForwarderConfig.saveStatus(this, "Notification listener connected.")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val settings = ForwarderConfig.readSettings(this)
        if (!settings.forwardEnabled) {
            return
        }
        if (!ForwarderNotifier.shouldForwardPackage(sbn.packageName, settings.forwardBusiness)) {
            return
        }

        val notification = ForwarderNotifier.buildForwardedNotification(sbn)
        Thread { forward(settings, notification) }.start()
    }

    private fun forward(settings: ForwarderSettings, notification: ForwardedNotification) {
        try {
            val payload = ForwarderNotifier.buildForwarderPayload(settings, notification)
            val result = ForwarderNotifier.postNotificationPayload(
                ForwarderNotifier.resolveNotificationWebhookUrl(settings),
                payload,
                settings.deviceToken
            )
            val message = if (result.statusCode in 200..299) {
                "Forwarded WhatsApp notification: HTTP ${result.statusCode}"
            } else {
                "Forward failed: HTTP ${result.statusCode} ${result.responseBody.takeAtMost(160)}"
            }
            ForwarderConfig.saveStatus(
                this,
                message,
                notification.title,
                notification.body,
                System.currentTimeMillis()
            )
        } catch (error: Exception) {
            ForwarderConfig.saveStatus(
                this,
                "Forward failed: ${error.safeMessage()}",
                notification.title,
                notification.body,
                System.currentTimeMillis()
            )
        }
    }
}
