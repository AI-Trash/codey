package com.codey.forwarder;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

public class KeepAliveService extends Service {
    private static final String KEEP_ALIVE_CHANNEL_ID = "codey_forwarder_keep_alive";
    private static final int KEEP_ALIVE_NOTIFICATION_ID = 1001;

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel();
        startForeground(KEEP_ALIVE_NOTIFICATION_ID, buildNotification());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
            KEEP_ALIVE_CHANNEL_ID,
            "Codey Forwarder",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(
            "Keeps Codey Forwarder visible while it listens for WhatsApp notifications."
        );
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, KEEP_ALIVE_CHANNEL_ID)
            : new Notification.Builder(this);

        return builder
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Codey Forwarder is ready")
            .setContentText("Listening for WhatsApp verification notifications.")
            .setOngoing(true)
            .build();
    }
}
