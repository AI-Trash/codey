package com.codey.forwarder;

final class ForwarderStatus {
    final String message;
    final String title;
    final String body;
    final long at;

    ForwarderStatus(String message, String title, String body, long at) {
        this.message = message;
        this.title = title;
        this.body = body;
        this.at = at;
    }
}
