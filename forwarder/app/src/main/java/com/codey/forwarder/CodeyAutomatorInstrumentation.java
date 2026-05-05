package com.codey.app;

import android.app.Instrumentation;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;

import org.json.JSONObject;

public final class CodeyAutomatorInstrumentation extends Instrumentation {
    private static final String TAG = "CodeyAutomator";
    private static final String DEFAULT_COMMAND = "gopay-unlink";
    private static final long DEFAULT_TIMEOUT_MS = 60_000L;
    private Bundle arguments;

    @Override
    public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        this.arguments = arguments == null ? new Bundle() : arguments;
        start();
    }

    @Override
    public void onStart() {
        super.onStart();
        runCommand(arguments == null ? new Bundle() : arguments);
    }

    private void runCommand(Bundle arguments) {
        int resultCode = 0;
        Bundle output = new Bundle();
        JSONObject payload;

        try {
            String command = stringArg(arguments, "command", DEFAULT_COMMAND);
            if (!DEFAULT_COMMAND.equals(command)) {
                throw new IllegalArgumentException("Unknown automator command: " + command);
            }
            long timeoutMs = longArg(arguments, "timeoutMs", DEFAULT_TIMEOUT_MS);
            SystemClock.sleep(250L);
            payload = new GoPayUnlinkUiAutomator(this, timeoutMs).run();
        } catch (Throwable error) {
            resultCode = 1;
            payload = new JSONObject();
            try {
                payload.put("ok", false);
                payload.put(
                    "error",
                    error.getMessage() != null ? error.getMessage() : error.getClass().getSimpleName()
                );
                payload.put("errorClass", error.getClass().getName());
            } catch (Exception ignored) {
            }
        }

        output.putString("codey_result", payload.toString());
        output.putString("stream", payload.toString() + "\n");
        Log.i(TAG, payload.toString());
        sendStatus(0, output);
        finishSafely(resultCode, output);
    }

    private void finishSafely(int resultCode, Bundle output) {
        waitForUiAutomationIdle();
        for (int attempt = 0; attempt < 20; attempt += 1) {
            try {
                finish(resultCode, output);
                return;
            } catch (IllegalStateException error) {
                if (!isUiAutomationConnectingError(error)) {
                    throw error;
                }
                SystemClock.sleep(100L);
            }
        }

        try {
            SystemClock.sleep(1_000L);
            finish(resultCode, output);
        } catch (IllegalStateException error) {
            if (!isUiAutomationConnectingError(error)) {
                throw error;
            }
            Log.e(TAG, "UiAutomation was still connecting while finishing instrumentation.", error);
        }
    }

    private void waitForUiAutomationIdle() {
        try {
            getUiAutomation().waitForIdle(100L, 2_000L);
        } catch (Throwable ignored) {
        }
    }

    private static boolean isUiAutomationConnectingError(IllegalStateException error) {
        String message = error.getMessage();
        return message != null && message.contains("Cannot call disconnect() while connecting UiAutomation");
    }

    private static String stringArg(Bundle arguments, String key, String fallback) {
        String value = arguments.getString(key);
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }

    private static long longArg(Bundle arguments, String key, long fallback) {
        String value = arguments.getString(key);
        if (value == null) {
            return fallback;
        }
        try {
            return Math.max(1L, Long.parseLong(value));
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }
}
