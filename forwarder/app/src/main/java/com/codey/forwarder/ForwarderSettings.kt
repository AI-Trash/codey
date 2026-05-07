package com.codey.app

data class ForwarderSettings(
    val codeyBaseUrl: String,
    val webhookUrl: String,
    val deviceId: String,
    val deviceToken: String,
    val whatsappPhoneNumber: String,
    val gopayPhoneNumber: String,
    val forwardEnabled: Boolean,
    val forwardBusiness: Boolean
)
