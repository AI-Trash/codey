package com.codey.app

data class ForwardedNotification(
    val packageName: String,
    val notificationId: String,
    val title: String?,
    val body: String?,
    val text: String?,
    val bigText: String?,
    val subText: String?,
    val conversationTitle: String?,
    val receivedAt: Long
)
