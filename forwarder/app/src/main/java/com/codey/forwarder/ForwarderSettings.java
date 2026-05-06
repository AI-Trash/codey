package com.codey.app;

final class ForwarderSettings {
    final String codeyBaseUrl;
    final String webhookUrl;
    final String deviceId;
    final String deviceToken;
    final String whatsappPhoneNumber;
    final String gopayPhoneNumber;
    final boolean forwardEnabled;
    final boolean forwardBusiness;

    ForwarderSettings(
        String codeyBaseUrl,
        String webhookUrl,
        String deviceId,
        String deviceToken,
        String whatsappPhoneNumber,
        String gopayPhoneNumber,
        boolean forwardEnabled,
        boolean forwardBusiness
    ) {
        this.codeyBaseUrl = codeyBaseUrl;
        this.webhookUrl = webhookUrl;
        this.deviceId = deviceId;
        this.deviceToken = deviceToken;
        this.whatsappPhoneNumber = whatsappPhoneNumber;
        this.gopayPhoneNumber = gopayPhoneNumber;
        this.forwardEnabled = forwardEnabled;
        this.forwardBusiness = forwardBusiness;
    }
}
