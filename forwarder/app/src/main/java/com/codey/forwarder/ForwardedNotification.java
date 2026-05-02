package com.codey.forwarder;

final class ForwardedNotification {
    final String packageName;
    final String notificationId;
    final String title;
    final String body;
    final String text;
    final String bigText;
    final String subText;
    final String conversationTitle;
    final long receivedAt;

    ForwardedNotification(
        String packageName,
        String notificationId,
        String title,
        String body,
        String text,
        String bigText,
        String subText,
        String conversationTitle,
        long receivedAt
    ) {
        this.packageName = packageName;
        this.notificationId = notificationId;
        this.title = title;
        this.body = body;
        this.text = text;
        this.bigText = bigText;
        this.subText = subText;
        this.conversationTitle = conversationTitle;
        this.receivedAt = receivedAt;
    }
}
