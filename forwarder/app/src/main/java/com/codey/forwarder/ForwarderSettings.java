package com.codey.forwarder;

final class ForwarderSettings {
    final String webhookUrl;
    final String deviceId;
    final boolean forwardEnabled;
    final boolean forwardBusiness;

    ForwarderSettings(
        String webhookUrl,
        String deviceId,
        boolean forwardEnabled,
        boolean forwardBusiness
    ) {
        this.webhookUrl = webhookUrl;
        this.deviceId = deviceId;
        this.forwardEnabled = forwardEnabled;
        this.forwardBusiness = forwardBusiness;
    }
}
