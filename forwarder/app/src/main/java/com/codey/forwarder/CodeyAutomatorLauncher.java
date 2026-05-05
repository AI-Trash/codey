package com.codey.app;

import android.content.Context;
import android.content.pm.ApplicationInfo;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.util.concurrent.TimeUnit;

import rikka.shizuku.Shizuku;

final class CodeyAutomatorLauncher {
    private static final int SHIZUKU_PERMISSION_REQUEST_CODE = 7721;

    private CodeyAutomatorLauncher() {}

    static AutomatorRunResult runGoPayUnlink(Context context, long timeoutMs) throws Exception {
        String instrumentCommand = buildInstrumentationCommand(
            context,
            "gopay-unlink",
            Math.max(1L, timeoutMs)
        );

        stopKnownUiAutomationRunners();
        CommandResult root = runLocalProcess(
            new String[] {"su", "-c", instrumentCommand},
            timeoutMs + 20_000L
        );
        if (root.exitCode == 0) {
            return AutomatorRunResult.fromCommand("root", root);
        }

        if (!hasShizukuPermission()) {
            requestShizukuPermission();
            return new AutomatorRunResult(
                false,
                "shizuku",
                root,
                null,
                "Root execution failed and Shizuku permission was requested. Try again after granting permission."
            );
        }

        CommandResult shizuku = runShizukuProcess(
            new String[] {"sh", "-c", instrumentCommand},
            timeoutMs + 20_000L
        );
        return AutomatorRunResult.fromCommand("shizuku", shizuku);
    }

    static boolean hasShizukuPermission() {
        try {
            return Shizuku.pingBinder() && Shizuku.checkSelfPermission() == 0;
        } catch (Throwable ignored) {
            return false;
        }
    }

    static void requestShizukuPermission() {
        try {
            if (Shizuku.pingBinder() && Shizuku.checkSelfPermission() != 0) {
                Shizuku.requestPermission(SHIZUKU_PERMISSION_REQUEST_CODE);
            }
        } catch (Throwable ignored) {
        }
    }

    private static void stopKnownUiAutomationRunners() {
        try {
            runLocalProcess(
                new String[] {"su", "-c", "am force-stop dev.mobile.maestro; am force-stop dev.mobile.maestro.test"},
                5_000L
            );
        } catch (Throwable ignored) {
        }
    }

    private static String buildInstrumentationCommand(
        Context context,
        String command,
        long timeoutMs
    ) {
        ApplicationInfo info = context.getApplicationInfo();
        String packageName = info.packageName;
        return "am instrument -w -r " +
            "-e command " + shellQuote(command) + " " +
            "-e timeoutMs " + timeoutMs + " " +
            shellQuote(packageName + "/.CodeyAutomatorInstrumentation");
    }

    private static CommandResult runLocalProcess(String[] command, long timeoutMs) throws Exception {
        Process process = new ProcessBuilder(command).start();
        return collect(process, timeoutMs);
    }

    private static CommandResult runShizukuProcess(String[] command, long timeoutMs) throws Exception {
        Method newProcess = Shizuku.class.getDeclaredMethod(
            "newProcess",
            String[].class,
            String[].class,
            String.class
        );
        newProcess.setAccessible(true);
        Process process = (Process) newProcess.invoke(null, command, null, null);
        return collect(process, timeoutMs);
    }

    private static CommandResult collect(Process process, long timeoutMs) throws Exception {
        StreamCollector stdout = new StreamCollector(process.getInputStream());
        StreamCollector stderr = new StreamCollector(process.getErrorStream());
        stdout.start();
        stderr.start();
        boolean completed = process.waitFor(Math.max(1L, timeoutMs), TimeUnit.MILLISECONDS);
        if (!completed) {
            process.destroyForcibly();
            throw new IllegalStateException("Timed out running Codey automator.");
        }
        stdout.join(1_000L);
        stderr.join(1_000L);
        return new CommandResult(process.exitValue(), stdout.output(), stderr.output());
    }

    private static String shellQuote(String value) {
        return "'" + value.replace("'", "'\\''") + "'";
    }

    static final class AutomatorRunResult {
        final boolean ok;
        final String mode;
        final CommandResult rootAttempt;
        final CommandResult commandResult;
        final JSONObject payload;
        final String error;

        AutomatorRunResult(
            boolean ok,
            String mode,
            CommandResult rootAttempt,
            CommandResult commandResult,
            String error
        ) {
            this.ok = ok;
            this.mode = mode;
            this.rootAttempt = rootAttempt;
            this.commandResult = commandResult;
            this.payload = parsePayload(commandResult != null ? commandResult.stdout : null);
            this.error = error;
        }

        static AutomatorRunResult fromCommand(String mode, CommandResult commandResult) {
            JSONObject payload = parsePayload(commandResult.stdout);
            String payloadError = payload != null ? payload.optString("error", null) : null;
            boolean ok = commandResult.exitCode == 0 && payload != null && payload.optBoolean("ok", false);
            String error = ok
                ? null
                : payloadError != null
                    ? payloadError
                    : take(commandResult.stderr.isEmpty() ? commandResult.stdout : commandResult.stderr, 240);
            return new AutomatorRunResult(ok, mode, null, commandResult, error);
        }

        private static JSONObject parsePayload(String output) {
            if (output == null) {
                return null;
            }
            String[] lines = output.trim().split("\\r?\\n");
            for (int index = lines.length - 1; index >= 0; index -= 1) {
                String line = lines[index].trim();
                if (line.startsWith("INSTRUMENTATION_RESULT: codey_result=")) {
                    line = line.substring("INSTRUMENTATION_RESULT: codey_result=".length()).trim();
                } else if (line.startsWith("INSTRUMENTATION_STATUS: codey_result=")) {
                    line = line.substring("INSTRUMENTATION_STATUS: codey_result=".length()).trim();
                }
                if (!line.startsWith("{") || !line.endsWith("}")) {
                    continue;
                }
                try {
                    return new JSONObject(line);
                } catch (Exception ignored) {
                }
            }
            return null;
        }
    }

    static final class CommandResult {
        final int exitCode;
        final String stdout;
        final String stderr;

        CommandResult(int exitCode, String stdout, String stderr) {
            this.exitCode = exitCode;
            this.stdout = stdout == null ? "" : stdout;
            this.stderr = stderr == null ? "" : stderr;
        }
    }

    private static final class StreamCollector extends Thread {
        private final InputStream stream;
        private final ByteArrayOutputStream output = new ByteArrayOutputStream();

        StreamCollector(InputStream stream) {
            this.stream = stream;
        }

        @Override
        public void run() {
            byte[] buffer = new byte[4096];
            try (InputStream input = stream) {
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                }
            } catch (Exception ignored) {
            }
        }

        String output() {
            return output.toString();
        }
    }

    private static String take(String value, int length) {
        if (value == null) {
            return "";
        }
        return value.length() <= length ? value : value.substring(0, length);
    }
}
