package com.codey.forwarder;

import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONObject;

public class ForwarderNotificationListenerService extends NotificationListenerService {
    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        ForwarderConfig.saveStatus(this, "Notification listener connected.");
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        ForwarderSettings settings = ForwarderConfig.readSettings(this);
        if (!settings.forwardEnabled) {
            return;
        }
        if (!ForwarderNotifier.shouldForwardPackage(sbn.getPackageName(), settings.forwardBusiness)) {
            return;
        }

        ForwardedNotification notification = ForwarderNotifier.buildForwardedNotification(sbn);
        new Thread(() -> forward(settings, notification)).start();
    }

    private void forward(ForwarderSettings settings, ForwardedNotification notification) {
        try {
            JSONObject payload = ForwarderNotifier.buildForwarderPayload(settings, notification);
            ForwarderNotifier.HttpResult result =
                ForwarderNotifier.postNotificationPayload(settings.webhookUrl, payload);
            String message = result.statusCode >= 200 && result.statusCode <= 299
                ? "Forwarded WhatsApp notification: HTTP " + result.statusCode
                : "Forward failed: HTTP " + result.statusCode + " " + take(result.responseBody, 160);
            ForwarderConfig.saveStatus(
                this,
                message,
                notification.title,
                notification.body,
                System.currentTimeMillis()
            );
        } catch (Exception error) {
            ForwarderConfig.saveStatus(
                this,
                "Forward failed: " + (error.getMessage() != null
                    ? error.getMessage()
                    : error.getClass().getSimpleName()),
                notification.title,
                notification.body,
                System.currentTimeMillis()
            );
        }
    }

    private static String take(String value, int length) {
        if (value == null) {
            return "";
        }
        return value.length() <= length ? value : value.substring(0, length);
    }
}
