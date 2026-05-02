package com.codey.forwarder;

import android.Manifest;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

public class MainActivity extends Activity {
    private EditText webhookUrlInput;
    private EditText deviceIdInput;
    private CheckBox enabledInput;
    private CheckBox businessInput;
    private TextView statusView;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(buildContentView());
        loadSettings();
        refreshStatus();
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshStatus();
    }

    private ScrollView buildContentView() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(32, 32, 32, 32);

        TextView title = new TextView(this);
        title.setText("Codey Forwarder");
        title.setTextSize(26f);
        root.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText("Listens for WhatsApp notifications and forwards them to Codey.");
        subtitle.setTextSize(15f);
        root.addView(subtitle);

        statusView = new TextView(this);
        statusView.setTextSize(14f);
        statusView.setPadding(0, 24, 0, 12);
        root.addView(statusView);

        webhookUrlInput = new EditText(this);
        webhookUrlInput.setHint("Webhook URL");
        webhookUrlInput.setMinLines(2);
        root.addView(webhookUrlInput, matchWidth());

        deviceIdInput = new EditText(this);
        deviceIdInput.setHint("Device ID");
        deviceIdInput.setSingleLine(true);
        root.addView(deviceIdInput, matchWidth());

        enabledInput = new CheckBox(this);
        enabledInput.setText("Forward WhatsApp notifications");
        root.addView(enabledInput);

        businessInput = new CheckBox(this);
        businessInput.setText("Include WhatsApp Business");
        root.addView(businessInput);

        Button saveButton = new Button(this);
        saveButton.setText("Save Settings");
        saveButton.setOnClickListener(view -> {
            saveSettings();
            ForwarderConfig.saveStatus(this, "Settings saved.");
            refreshStatus();
        });
        root.addView(saveButton, matchWidth());

        root.addView(buttonRow(
            button("Notification Access", () ->
                startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))),
            button("Refresh", this::refreshStatus)
        ));

        root.addView(buttonRow(
            button("Start Keep Alive", () -> {
                requestNotificationPermissionIfNeeded();
                Intent intent = new Intent(this, KeepAliveService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(intent);
                } else {
                    startService(intent);
                }
            }),
            button("Battery Settings", this::openBatterySettings)
        ));

        Button testButton = new Button(this);
        testButton.setText("Send Test Payload");
        testButton.setOnClickListener(view -> {
            saveSettings();
            sendTestPayload();
        });
        root.addView(testButton, matchWidth());

        TextView hint = new TextView(this);
        hint.setText(
            "Emulator: keep 10.0.2.2. Physical phone: use the computer LAN IP " +
                "with FORWARDER_WEBHOOK_HOST=0.0.0.0, or run adb reverse " +
                "tcp:3001 tcp:3001 and use 127.0.0.1."
        );
        hint.setTextSize(13f);
        hint.setPadding(0, 20, 0, 0);
        root.addView(hint);

        ScrollView scrollView = new ScrollView(this);
        scrollView.addView(root);
        return scrollView;
    }

    private void loadSettings() {
        ForwarderSettings settings = ForwarderConfig.readSettings(this);
        webhookUrlInput.setText(settings.webhookUrl);
        deviceIdInput.setText(settings.deviceId);
        enabledInput.setChecked(settings.forwardEnabled);
        businessInput.setChecked(settings.forwardBusiness);
    }

    private void saveSettings() {
        ForwarderConfig.saveSettings(
            this,
            new ForwarderSettings(
                webhookUrlInput.getText().toString(),
                deviceIdInput.getText().toString(),
                enabledInput.isChecked(),
                businessInput.isChecked()
            )
        );
    }

    private void refreshStatus() {
        ForwarderStatus status = ForwarderConfig.readStatus(this);
        StringBuilder detail = new StringBuilder();
        detail.append("Notification access: ");
        detail.append(isNotificationListenerEnabled() ? "enabled" : "not enabled");
        detail.append('\n');
        detail.append("Battery optimization: ");
        detail.append(isIgnoringBatteryOptimizations() ? "ignored" : "may stop background work");
        detail.append('\n');
        detail.append(status.message);
        if (status.title != null && !status.title.trim().isEmpty()) {
            detail.append("\nLast title: ").append(status.title);
        }
        if (status.body != null && !status.body.trim().isEmpty()) {
            detail.append("\nLast body: ").append(status.body);
        }
        statusView.setText(detail.toString());
    }

    private void sendTestPayload() {
        new Thread(() -> {
            ForwarderSettings settings = ForwarderConfig.readSettings(this);
            ForwardedNotification sample = new ForwardedNotification(
                "com.whatsapp",
                "test-" + System.currentTimeMillis(),
                "Codey test",
                "Your verification code is 123456.",
                "Your verification code is 123456.",
                null,
                null,
                "Codey",
                System.currentTimeMillis()
            );

            try {
                JSONObject payload = ForwarderNotifier.buildForwarderPayload(settings, sample);
                ForwarderNotifier.HttpResult result =
                    ForwarderNotifier.postNotificationPayload(settings.webhookUrl, payload);
                String message = result.statusCode >= 200 && result.statusCode <= 299
                    ? "Test forwarded: HTTP " + result.statusCode
                    : "Test failed: HTTP " + result.statusCode + " " +
                        take(result.responseBody, 120);
                ForwarderConfig.saveStatus(this, message, sample.title, sample.body);
            } catch (Exception error) {
                ForwarderConfig.saveStatus(
                    this,
                    "Test failed: " + (error.getMessage() != null
                        ? error.getMessage()
                        : error.getClass().getSimpleName()),
                    sample.title,
                    sample.body
                );
            }

            mainHandler.post(this::refreshStatus);
        }).start();
    }

    private void requestNotificationPermissionIfNeeded() {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                    PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 100);
        }
    }

    private boolean isNotificationListenerEnabled() {
        String flattened = Settings.Secure.getString(
            getContentResolver(),
            "enabled_notification_listeners"
        );
        if (flattened == null) {
            return false;
        }
        ComponentName serviceName = new ComponentName(
            this,
            ForwarderNotificationListenerService.class
        );
        TextUtils.SimpleStringSplitter splitter = new TextUtils.SimpleStringSplitter(':');
        splitter.setString(flattened);
        while (splitter.hasNext()) {
            ComponentName enabled = ComponentName.unflattenFromString(splitter.next());
            if (serviceName.equals(enabled)) {
                return true;
            }
        }
        return false;
    }

    private boolean isIgnoringBatteryOptimizations() {
        PowerManager powerManager = getSystemService(PowerManager.class);
        return powerManager != null && powerManager.isIgnoringBatteryOptimizations(getPackageName());
    }

    private void openBatterySettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                .setData(Uri.parse("package:" + getPackageName()));
            try {
                startActivity(intent);
            } catch (Exception error) {
                startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            }
            return;
        }

        startActivity(new Intent(Settings.ACTION_SETTINGS));
    }

    private Button button(String text, Runnable onClick) {
        Button button = new Button(this);
        button.setText(text);
        button.setOnClickListener(view -> onClick.run());
        return button;
    }

    private LinearLayout buttonRow(Button left, Button right) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.addView(left, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        row.addView(right, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        return row;
    }

    private LinearLayout.LayoutParams matchWidth() {
        return new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
    }

    private static String take(String value, int length) {
        if (value == null) {
            return "";
        }
        return value.length() <= length ? value : value.substring(0, length);
    }
}
