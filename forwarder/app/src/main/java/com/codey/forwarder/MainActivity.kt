@file:Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")

package com.codey.app

import android.Manifest
import android.content.ComponentName
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.text.TextUtils
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.google.zxing.integration.android.IntentIntegrator
import com.google.zxing.integration.android.IntentResult

class MainActivity : ComponentActivity() {
    private val mainHandler = Handler(Looper.getMainLooper())

    private var codeyBaseUrl by mutableStateOf("")
    private var deviceId by mutableStateOf("")
    private var whatsappPhoneNumber by mutableStateOf("")
    private var gopayPhoneNumber by mutableStateOf("")
    private var forwardEnabled by mutableStateOf(true)
    private var forwardBusiness by mutableStateOf(true)
    private var statusText by mutableStateOf("")
    private var pairingText by mutableStateOf("")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        loadSettings()
        setContent {
            CodeyAppTheme {
                ForwarderAppScreen(
                    codeyBaseUrl = codeyBaseUrl,
                    onCodeyBaseUrlChange = { codeyBaseUrl = it },
                    deviceId = deviceId,
                    onDeviceIdChange = { deviceId = it },
                    whatsappPhoneNumber = whatsappPhoneNumber,
                    onWhatsappPhoneNumberChange = { whatsappPhoneNumber = it },
                    gopayPhoneNumber = gopayPhoneNumber,
                    onGopayPhoneNumberChange = { gopayPhoneNumber = it },
                    forwardEnabled = forwardEnabled,
                    onForwardEnabledChange = { forwardEnabled = it },
                    forwardBusiness = forwardBusiness,
                    onForwardBusinessChange = { forwardBusiness = it },
                    statusText = statusText,
                    pairingText = pairingText,
                    onSaveSettings = {
                        saveSettings()
                        ForwarderConfig.saveStatus(this, "Settings saved.")
                        refreshStatus()
                    },
                    onRefresh = { refreshStatus() },
                    onStartPairing = { startPairing() },
                    onCompletePairing = { completePairing() },
                    onScanPairingQr = { scanPairingQr() },
                    onOpenPairingLink = { openPairingLink() },
                    onCopyPairingLink = { copyPairingLink() },
                    onCopyPairingUserCode = { copyPairingUserCode() },
                    onNotificationAccess = {
                        startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                    },
                    onSendTestPayload = { sendTestPayload() },
                    onStartKeepAlive = { startKeepAlive() },
                    onBatterySettings = { openBatterySettings() },
                    onShizukuPermission = { requestShizukuPermission() },
                    onInstallAutomatorHost = { installAutomatorHost() },
                    onRunGoPayUnlink = { runGoPayUnlink() }
                )
            }
        }
        handleIncomingPairingIntent(intent)
        refreshStatus()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingPairingIntent(intent)
        refreshStatus()
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    private fun loadSettings() {
        val settings = ForwarderConfig.readSettings(this)
        codeyBaseUrl = settings.codeyBaseUrl
        deviceId = settings.deviceId
        whatsappPhoneNumber = settings.whatsappPhoneNumber
        gopayPhoneNumber = settings.gopayPhoneNumber
        forwardEnabled = settings.forwardEnabled
        forwardBusiness = settings.forwardBusiness
    }

    private fun saveSettings() {
        ForwarderConfig.saveSettings(
            this,
            ForwarderSettings(
                codeyBaseUrl,
                deviceId,
                ForwarderConfig.readSettings(this).deviceToken,
                whatsappPhoneNumber,
                gopayPhoneNumber,
                forwardEnabled,
                forwardBusiness
            )
        )
    }

    private fun refreshStatus() {
        val status = ForwarderConfig.readStatus(this)
        val settings = ForwarderConfig.readSettings(this)
        statusText = buildString {
            append(
                getString(
                    R.string.status_notification_access,
                    getString(
                        if (isNotificationListenerEnabled()) {
                            R.string.status_notification_enabled
                        } else {
                            R.string.status_notification_disabled
                        }
                    )
                )
            )
            append('\n')
            append(
                getString(
                    R.string.status_battery_optimization,
                    getString(
                        if (isIgnoringBatteryOptimizations()) {
                            R.string.status_battery_ignored
                        } else {
                            R.string.status_battery_may_stop
                        }
                    )
                )
            )
            append('\n')
            append(
                getString(
                    R.string.status_pairing,
                    getString(
                        if (settings.deviceToken.trim().isEmpty()) {
                            R.string.status_pairing_not_paired
                        } else {
                            R.string.status_pairing_paired
                        }
                    )
                )
            )
            append('\n')
            append(status.message)
            if (!status.title.isNullOrBlank()) {
                append('\n')
                append(getString(R.string.status_last_title, status.title))
            }
            if (!status.body.isNullOrBlank()) {
                append('\n')
                append(getString(R.string.status_last_body, status.body))
            }
        }

        val pairing = ForwarderConfig.readPairingState(this)
        pairingText = if (pairing.hasPendingChallenge()) {
            buildString {
                append(
                    getString(
                        R.string.pairing_pending_user_code,
                        pairing.userCode.trim().ifEmpty {
                            getString(R.string.pairing_unknown)
                        }
                    )
                )
                if (pairing.approvalUrl.trim().isNotEmpty()) {
                    append('\n')
                    append(getString(R.string.pairing_approval_url, pairing.approvalUrl))
                }
            }
        } else {
            getString(R.string.pairing_none)
        }
    }

    private fun startPairing() {
        saveSettings()
        Thread {
            try {
                val settings = ForwarderConfig.readSettings(this)
                val challenge = CodeyDevicePairingClient.startPairing(settings)
                val verificationUrl =
                    challenge.verificationUriComplete.trim().ifEmpty {
                        challenge.verificationUri
                    }
                ForwarderConfig.savePairingState(
                    this,
                    challenge.deviceCode,
                    challenge.userCode,
                    verificationUrl
                )
                ForwarderConfig.saveStatus(
                    this,
                    "Pairing started. Approve user code ${challenge.userCode} at $verificationUrl"
                )
            } catch (error: Exception) {
                ForwarderConfig.saveStatus(this, "Pairing start failed: ${error.safeMessage()}")
            }
            mainHandler.post { refreshStatus() }
        }.start()
    }

    private fun completePairing() {
        saveSettings()
        Thread {
            try {
                val pairing = ForwarderConfig.readPairingState(this)
                if (!pairing.hasPendingChallenge()) {
                    throw Exception("Start pairing first.")
                }
                val settings = ForwarderConfig.readSettings(this)
                val result = CodeyDevicePairingClient.completePairing(settings, pairing.deviceCode)
                ForwarderConfig.saveDeviceToken(this, result.deviceToken)
                ForwarderConfig.saveStatus(
                    this,
                    "Paired with Codey Web as ${result.deviceId} (${result.mobileDeviceId})."
                )
            } catch (error: Exception) {
                ForwarderConfig.saveStatus(
                    this,
                    "Pairing completion failed: ${error.safeMessage()}"
                )
            }
            mainHandler.post { refreshStatus() }
        }.start()
    }

    private fun scanPairingQr() {
        IntentIntegrator(this).apply {
            setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
            setPrompt("Scan the Codey Web mobile pairing QR code")
            setBeepEnabled(false)
            setOrientationLocked(false)
            initiateScan()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        val result: IntentResult? =
            IntentIntegrator.parseActivityResult(requestCode, resultCode, data)
        if (result != null) {
            if (result.contents == null) {
                ForwarderConfig.saveStatus(this, "Pairing QR scan canceled.")
            } else {
                applyPairingLink(result.contents)
            }
            refreshStatus()
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    private fun handleIncomingPairingIntent(intent: Intent?) {
        if (
            intent == null ||
            intent.data == null ||
            Intent.ACTION_VIEW != intent.action
        ) {
            return
        }

        applyPairingLink(intent.data.toString())
    }

    private fun applyPairingLink(rawLink: String) {
        try {
            saveSettings()
            val link = CodeyPairingLink.parse(rawLink)
            val current = ForwarderConfig.readSettings(this)
            ForwarderConfig.saveSettings(
                this,
                ForwarderSettings(
                    link.baseUrl,
                    current.deviceId,
                    current.deviceToken,
                    current.whatsappPhoneNumber,
                    current.gopayPhoneNumber,
                    current.forwardEnabled,
                    current.forwardBusiness
                )
            )
            ForwarderConfig.savePairingState(
                this,
                link.deviceCode,
                link.userCode,
                link.approvalUrl()
            )
            mainHandler.post { loadSettings() }
            ForwarderConfig.saveStatus(
                this,
                "Pairing QR loaded. Approve user code ${link.userCode} in Codey Web, then tap Complete Pairing."
            )
        } catch (error: Exception) {
            ForwarderConfig.saveStatus(this, "Pairing QR rejected: ${error.safeMessage()}")
        }
    }

    private fun openPairingLink() {
        val pairing = ForwarderConfig.readPairingState(this)
        if (pairing.approvalUrl.trim().isEmpty()) {
            ForwarderConfig.saveStatus(this, "No pairing approval link available.")
            refreshStatus()
            return
        }

        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(pairing.approvalUrl)))
    }

    private fun copyPairingLink() {
        val pairing = ForwarderConfig.readPairingState(this)
        if (pairing.approvalUrl.trim().isEmpty()) {
            ForwarderConfig.saveStatus(this, "No pairing approval link available.")
            refreshStatus()
            return
        }

        copyToClipboard("Codey pairing link", pairing.approvalUrl)
        ForwarderConfig.saveStatus(this, "Pairing approval link copied.")
        refreshStatus()
    }

    private fun copyPairingUserCode() {
        val pairing = ForwarderConfig.readPairingState(this)
        if (pairing.userCode.trim().isEmpty()) {
            ForwarderConfig.saveStatus(this, "No pairing user code available.")
            refreshStatus()
            return
        }

        copyToClipboard("Codey pairing user code", pairing.userCode)
        ForwarderConfig.saveStatus(this, "Pairing user code copied.")
        refreshStatus()
    }

    private fun copyToClipboard(label: String, value: String) {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        clipboard?.setPrimaryClip(ClipData.newPlainText(label, value))
    }

    private fun startKeepAlive() {
        requestNotificationPermissionIfNeeded()
        val intent = Intent(this, KeepAliveService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun requestShizukuPermission() {
        CodeyAutomatorLauncher.requestShizukuPermission()
        ForwarderConfig.saveStatus(
            this,
            if (CodeyAutomatorLauncher.hasShizukuPermission()) {
                "Shizuku permission is already granted."
            } else {
                "Shizuku permission requested."
            }
        )
        refreshStatus()
    }

    private fun installAutomatorHost() {
        Thread {
            try {
                val result = CodeyAutomatorLauncher.ensureAutomatorHostReady(this)
                val message = if (result.installed) {
                    "Codey Automator Host installed via ${result.mode}."
                } else {
                    "Codey Automator Host is already installed."
                }
                ForwarderConfig.saveStatus(this, message)
            } catch (error: Exception) {
                ForwarderConfig.saveStatus(
                    this,
                    "Codey Automator Host install failed: ${error.safeMessage()}"
                )
            }
            mainHandler.post { refreshStatus() }
        }.start()
    }

    private fun runGoPayUnlink() {
        Thread {
            try {
                val result = CodeyAutomatorLauncher.runGoPayUnlink(this, 60_000L)
                val message = if (result.ok) {
                    "GoPay unlink completed via ${result.mode}: ${
                        result.payload?.optString("status", "ok") ?: "ok"
                    }"
                } else {
                    "GoPay unlink failed via ${result.mode}: ${result.error}"
                }
                ForwarderConfig.saveStatus(this, message)
            } catch (error: Exception) {
                ForwarderConfig.saveStatus(this, "GoPay unlink failed: ${error.safeMessage()}")
            }
            mainHandler.post { refreshStatus() }
        }.start()
    }

    private fun sendTestPayload() {
        Thread {
            val sample = ForwardedNotification(
                "com.whatsapp",
                "test-${System.currentTimeMillis()}",
                "Codey test",
                "Your verification code is 123456.",
                "Your verification code is 123456.",
                null,
                null,
                "Codey test",
                System.currentTimeMillis()
            )

            try {
                val settings = ForwarderConfig.readSettings(this)
                val payload = ForwarderNotifier.buildForwarderPayload(settings, sample)
                val result = ForwarderNotifier.postNotificationPayload(settings, payload)
                val message = if (result.statusCode in 200..299) {
                    "Test forwarded to Codey Web: HTTP ${result.statusCode}"
                } else {
                    "Test to Codey Web failed: HTTP ${result.statusCode} ${
                        result.responseBody.takeAtMost(120)
                    }"
                }
                ForwarderConfig.saveStatus(this, message, sample.title, sample.body)
            } catch (error: Exception) {
                ForwarderConfig.saveStatus(
                    this,
                    "Test to Codey Web failed: ${error.safeMessage()}",
                    sample.title,
                    sample.body
                )
            }

            mainHandler.post { refreshStatus() }
        }.start()
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 100)
        }
    }

    private fun isNotificationListenerEnabled(): Boolean {
        val flattened = Settings.Secure.getString(
            contentResolver,
            "enabled_notification_listeners"
        ) ?: return false
        val serviceName = ComponentName(this, ForwarderNotificationListenerService::class.java)
        val splitter = TextUtils.SimpleStringSplitter(':')
        splitter.setString(flattened)
        while (splitter.hasNext()) {
            val componentName = ComponentName.unflattenFromString(splitter.next())
            if (componentName == serviceName) {
                return true
            }
        }
        return false
    }

    private fun isIgnoringBatteryOptimizations(): Boolean {
        val powerManager = getSystemService(PowerManager::class.java)
        return powerManager != null && powerManager.isIgnoringBatteryOptimizations(packageName)
    }

    private fun openBatterySettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                .setData(Uri.parse("package:$packageName"))
            try {
                startActivity(intent)
            } catch (_: Exception) {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }
            return
        }

        startActivity(Intent(Settings.ACTION_SETTINGS))
    }
}

@Composable
private fun CodeyAppTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = MaterialTheme.colorScheme.copy(
            primary = androidx.compose.ui.graphics.Color(0xFF2563EB),
            secondary = androidx.compose.ui.graphics.Color(0xFF0F766E),
            tertiary = androidx.compose.ui.graphics.Color(0xFFB45309),
            surface = androidx.compose.ui.graphics.Color(0xFFFAFAFA),
            background = androidx.compose.ui.graphics.Color(0xFFF6F7FB)
        ),
        content = content
    )
}

@Composable
private fun ForwarderAppScreen(
    codeyBaseUrl: String,
    onCodeyBaseUrlChange: (String) -> Unit,
    deviceId: String,
    onDeviceIdChange: (String) -> Unit,
    whatsappPhoneNumber: String,
    onWhatsappPhoneNumberChange: (String) -> Unit,
    gopayPhoneNumber: String,
    onGopayPhoneNumberChange: (String) -> Unit,
    forwardEnabled: Boolean,
    onForwardEnabledChange: (Boolean) -> Unit,
    forwardBusiness: Boolean,
    onForwardBusinessChange: (Boolean) -> Unit,
    statusText: String,
    pairingText: String,
    onSaveSettings: () -> Unit,
    onRefresh: () -> Unit,
    onStartPairing: () -> Unit,
    onCompletePairing: () -> Unit,
    onScanPairingQr: () -> Unit,
    onOpenPairingLink: () -> Unit,
    onCopyPairingLink: () -> Unit,
    onCopyPairingUserCode: () -> Unit,
    onNotificationAccess: () -> Unit,
    onSendTestPayload: () -> Unit,
    onStartKeepAlive: () -> Unit,
    onBatterySettings: () -> Unit,
    onShizukuPermission: () -> Unit,
    onInstallAutomatorHost: () -> Unit,
    onRunGoPayUnlink: () -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = stringResource(R.string.app_name),
                    style = MaterialTheme.typography.headlineMedium
                )
                Text(
                    text = stringResource(R.string.app_subtitle),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.7f)
                )
            }

            InfoSection(
                title = stringResource(R.string.section_status),
                text = statusText.ifBlank { stringResource(R.string.pairing_none) }
            )

            FormSection(title = stringResource(R.string.section_connection)) {
                AppTextField(
                    value = codeyBaseUrl,
                    onValueChange = onCodeyBaseUrlChange,
                    label = stringResource(R.string.label_codey_web_url),
                    keyboardType = KeyboardType.Uri
                )
                AppTextField(
                    value = deviceId,
                    onValueChange = onDeviceIdChange,
                    label = stringResource(R.string.label_device_id)
                )
            }

            FormSection(title = stringResource(R.string.section_device)) {
                AppTextField(
                    value = whatsappPhoneNumber,
                    onValueChange = onWhatsappPhoneNumberChange,
                    label = stringResource(R.string.label_whatsapp_phone_number),
                    keyboardType = KeyboardType.Phone
                )
                AppTextField(
                    value = gopayPhoneNumber,
                    onValueChange = onGopayPhoneNumberChange,
                    label = stringResource(R.string.label_gopay_phone_number),
                    keyboardType = KeyboardType.Phone
                )
                CheckRow(
                    checked = forwardEnabled,
                    onCheckedChange = onForwardEnabledChange,
                    label = stringResource(R.string.option_forward_whatsapp)
                )
                CheckRow(
                    checked = forwardBusiness,
                    onCheckedChange = onForwardBusinessChange,
                    label = stringResource(R.string.option_include_business)
                )
                Button(
                    onClick = onSaveSettings,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(stringResource(R.string.action_save_settings))
                }
            }

            FormSection(title = stringResource(R.string.section_pairing)) {
                Text(
                    text = pairingText.ifBlank { stringResource(R.string.pairing_none) },
                    style = MaterialTheme.typography.bodyMedium
                )
                ActionRow(
                    leftText = stringResource(R.string.action_start_pairing),
                    onLeftClick = onStartPairing,
                    rightText = stringResource(R.string.action_complete_pairing),
                    onRightClick = onCompletePairing
                )
                ActionRow(
                    leftText = stringResource(R.string.action_scan_web_qr),
                    onLeftClick = onScanPairingQr,
                    rightText = stringResource(R.string.action_open_pairing_link),
                    onRightClick = onOpenPairingLink
                )
                ActionRow(
                    leftText = stringResource(R.string.action_copy_pairing_link),
                    onLeftClick = onCopyPairingLink,
                    rightText = stringResource(R.string.action_copy_user_code),
                    onRightClick = onCopyPairingUserCode
                )
            }

            FormSection(title = stringResource(R.string.section_actions)) {
                ActionRow(
                    leftText = stringResource(R.string.action_notification_access),
                    onLeftClick = onNotificationAccess,
                    rightText = stringResource(R.string.action_send_test_payload),
                    onRightClick = onSendTestPayload
                )
                ActionRow(
                    leftText = stringResource(R.string.action_start_keep_alive),
                    onLeftClick = onStartKeepAlive,
                    rightText = stringResource(R.string.action_refresh),
                    onRightClick = onRefresh
                )
                ActionRow(
                    leftText = stringResource(R.string.action_shizuku_permission),
                    onLeftClick = onShizukuPermission,
                    rightText = stringResource(R.string.action_install_automator_host),
                    onRightClick = onInstallAutomatorHost
                )
                ActionRow(
                    leftText = stringResource(R.string.action_battery_settings),
                    onLeftClick = onBatterySettings,
                    rightText = stringResource(R.string.action_run_gopay_unlink),
                    onRightClick = onRunGoPayUnlink
                )
            }

            Text(
                text = stringResource(R.string.hint_network),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.72f)
            )
        }
    }
}

@Composable
private fun InfoSection(title: String, text: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(text = title, style = MaterialTheme.typography.titleMedium)
            Text(text = text, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun FormSection(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(text = title, style = MaterialTheme.typography.titleMedium)
            content()
        }
    }
}

@Composable
private fun AppTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    minLines: Int = 1,
    keyboardType: KeyboardType = KeyboardType.Text
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        modifier = Modifier.fillMaxWidth(),
        minLines = minLines,
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        singleLine = minLines == 1
    )
}

@Composable
private fun CheckRow(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    label: String
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Checkbox(checked = checked, onCheckedChange = onCheckedChange)
        Text(text = label, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun ActionRow(
    leftText: String,
    onLeftClick: () -> Unit,
    rightText: String,
    onRightClick: () -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Button(
            onClick = onLeftClick,
            modifier = Modifier.weight(1f)
        ) {
            Text(leftText)
        }
        Button(
            onClick = onRightClick,
            modifier = Modifier.weight(1f)
        ) {
            Text(rightText)
        }
    }
}
