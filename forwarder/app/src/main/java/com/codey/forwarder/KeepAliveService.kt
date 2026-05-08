package com.codey.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder

class KeepAliveService : Service() {
    override fun onCreate() {
        super.onCreate()
        ensureChannel()
        startForeground(KEEP_ALIVE_NOTIFICATION_ID, buildNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }

        val channel = NotificationChannel(
            KEEP_ALIVE_CHANNEL_ID,
            "CodeyApp",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Keeps CodeyApp visible for Android automation tasks."
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    @Suppress("DEPRECATION")
    private fun buildNotification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, KEEP_ALIVE_CHANNEL_ID)
        } else {
            Notification.Builder(this)
        }

        return builder
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("CodeyApp is ready")
            .setContentText("Ready for Codey Android automation tasks.")
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val KEEP_ALIVE_CHANNEL_ID = "codey_app_keep_alive"
        private const val KEEP_ALIVE_NOTIFICATION_ID = 1001
    }
}
