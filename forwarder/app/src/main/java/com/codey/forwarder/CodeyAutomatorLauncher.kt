package com.codey.app

import android.content.Context
import android.content.pm.PackageManager
import org.json.JSONObject
import rikka.shizuku.Shizuku
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.lang.reflect.Method
import java.util.concurrent.TimeUnit
import kotlin.math.max

object CodeyAutomatorLauncher {
    private const val SHIZUKU_PERMISSION_REQUEST_CODE = 7721
    private const val AUTOMATOR_HOST_PACKAGE = "com.codey.automatorhost"
    private const val AUTOMATOR_HOST_ASSET = "codey-automator-host.apk"

    fun runGoPayUnlink(context: Context, timeoutMs: Long): AutomatorRunResult {
        ensureAutomatorHostReady(context)
        val instrumentCommand = buildInstrumentationCommand(
            context,
            "gopay-unlink",
            max(1L, timeoutMs)
        )

        stopKnownUiAutomationRunners()
        val root = runLocalProcess(
            arrayOf("su", "-c", instrumentCommand),
            timeoutMs + 20_000L
        )
        val rootResult = AutomatorRunResult.fromCommand("root", root)
        if (rootResult.ok || root.exitCode == 0) {
            return rootResult
        }

        if (!hasShizukuPermission()) {
            requestShizukuPermission()
            return AutomatorRunResult(
                ok = false,
                mode = "shizuku",
                rootAttempt = root,
                commandResult = null,
                error = "Root execution failed and Shizuku permission was requested. Try again after granting permission."
            )
        }

        val shizuku = runShizukuProcess(
            arrayOf("sh", "-c", instrumentCommand),
            timeoutMs + 20_000L
        )
        return AutomatorRunResult.fromCommand("shizuku", shizuku)
    }

    fun hasShizukuPermission(): Boolean {
        return try {
            Shizuku.pingBinder() && Shizuku.checkSelfPermission() == 0
        } catch (_: Throwable) {
            false
        }
    }

    fun requestShizukuPermission() {
        try {
            if (Shizuku.pingBinder() && Shizuku.checkSelfPermission() != 0) {
                Shizuku.requestPermission(SHIZUKU_PERMISSION_REQUEST_CODE)
            }
        } catch (_: Throwable) {
        }
    }

    private fun stopKnownUiAutomationRunners() {
        try {
            runLocalProcess(
                arrayOf(
                    "su",
                    "-c",
                    "am force-stop dev.mobile.maestro; am force-stop dev.mobile.maestro.test"
                ),
                5_000L
            )
        } catch (_: Throwable) {
        }
    }

    private fun buildInstrumentationCommand(
        context: Context,
        command: String,
        timeoutMs: Long
    ): String {
        val packageName = context.applicationInfo.packageName
        return "am instrument -w -r " +
            "-e command ${shellQuote(command)} " +
            "-e timeoutMs $timeoutMs " +
            shellQuote("$packageName/.CodeyAutomatorInstrumentation")
    }

    fun ensureAutomatorHostReady(context: Context): AutomatorHostInstallResult {
        if (isAutomatorHostSignatureValid(context)) {
            return AutomatorHostInstallResult(false, "installed", null, null)
        }

        val apkFile = writeAutomatorHostApk(context)
        try {
            val root = installAutomatorHostWithRoot(apkFile)
            if (root.exitCode == 0 && isAutomatorHostSignatureValid(context)) {
                return AutomatorHostInstallResult(true, "root", root, null)
            }

            if (!hasShizukuPermission()) {
                requestShizukuPermission()
                throw IllegalStateException(
                    "Codey Automator Host install needs root or Shizuku permission. Shizuku permission was requested; grant it and try again."
                )
            }

            val shizuku = installAutomatorHostWithShizuku(apkFile)
            if (shizuku.exitCode == 0 && isAutomatorHostSignatureValid(context)) {
                return AutomatorHostInstallResult(true, "shizuku", root, shizuku)
            }

            val error = listOf(root, shizuku)
                .map { result ->
                    val output = (result.stderr.ifBlank { result.stdout }).takeAtMost(240)
                    output.ifBlank { "exitCode=${result.exitCode}" }
                }
                .joinToString("; ")
            throw IllegalStateException(
                "Codey Automator Host install failed or installed with the wrong signature: $error"
            )
        } finally {
            apkFile.delete()
        }
    }

    private fun isAutomatorHostSignatureValid(context: Context): Boolean {
        return try {
            context.packageManager.getPackageInfo(AUTOMATOR_HOST_PACKAGE, 0)
            context.packageManager.checkSignatures(
                context.applicationInfo.packageName,
                AUTOMATOR_HOST_PACKAGE
            ) == PackageManager.SIGNATURE_MATCH
        } catch (_: Exception) {
            false
        }
    }

    private fun writeAutomatorHostApk(context: Context): File {
        val directory = context.externalCacheDir ?: context.cacheDir
        if (!directory.exists()) {
            directory.mkdirs()
        }
        val apkFile = File(directory, AUTOMATOR_HOST_ASSET)
        context.assets.open(AUTOMATOR_HOST_ASSET).use { input ->
            apkFile.outputStream().use { output ->
                input.copyTo(output)
            }
        }
        apkFile.setReadable(true, false)
        return apkFile
    }

    private fun installAutomatorHostWithRoot(apkFile: File): CommandResult {
        return try {
            val firstAttempt = runRootInstall(apkFile)
            if (!isUpdateIncompatible(firstAttempt)) {
                return firstAttempt
            }

            runLocalProcess(
                arrayOf("su", "-c", "pm uninstall $AUTOMATOR_HOST_PACKAGE"),
                60_000L
            )
            runRootInstall(apkFile)
        } catch (error: Exception) {
            CommandResult(
                1,
                "",
                "Root install failed: ${error.safeInstallerMessage()}"
            )
        }
    }

    private fun installAutomatorHostWithShizuku(apkFile: File): CommandResult {
        return try {
            val firstAttempt = runShizukuInstall(apkFile)
            if (!isUpdateIncompatible(firstAttempt)) {
                return firstAttempt
            }

            runShizukuProcess(
                arrayOf("sh", "-c", "pm uninstall $AUTOMATOR_HOST_PACKAGE"),
                60_000L
            )
            runShizukuInstall(apkFile)
        } catch (error: Exception) {
            CommandResult(
                1,
                "",
                "Shizuku install failed: ${error.safeInstallerMessage()}"
            )
        }
    }

    private fun runRootInstall(apkFile: File): CommandResult {
        return runLocalProcess(
            arrayOf("su", "-c", installCommand(apkFile.absolutePath)),
            60_000L
        )
    }

    private fun runShizukuInstall(apkFile: File): CommandResult {
        return runShizukuProcess(
            arrayOf("sh", "-c", installCommand(apkFile.absolutePath)),
            60_000L
        )
    }

    private fun isUpdateIncompatible(result: CommandResult): Boolean {
        return result.stdout.contains("INSTALL_FAILED_UPDATE_INCOMPATIBLE") ||
            result.stderr.contains("INSTALL_FAILED_UPDATE_INCOMPATIBLE")
    }

    private fun installCommand(apkPath: String): String {
        val installerApkPath = "/data/local/tmp/$AUTOMATOR_HOST_ASSET"
        return "rm -f ${shellQuote(installerApkPath)}; " +
            "cp ${shellQuote(apkPath)} ${shellQuote(installerApkPath)} && " +
            "chmod 0644 ${shellQuote(installerApkPath)} && " +
            "pm install -r ${shellQuote(installerApkPath)}; " +
            "rc=\$?; " +
            "rm -f ${shellQuote(installerApkPath)}; " +
            "exit \$rc"
    }

    private fun runLocalProcess(command: Array<String>, timeoutMs: Long): CommandResult {
        val process = ProcessBuilder(*command).start()
        return collect(process, timeoutMs)
    }

    private fun runShizukuProcess(command: Array<String>, timeoutMs: Long): CommandResult {
        return collect(startShizukuProcess(command), timeoutMs)
    }

    private fun startShizukuProcess(command: Array<String>): Process {
        val newProcess: Method = Shizuku::class.java.getDeclaredMethod(
            "newProcess",
            Array<String>::class.java,
            Array<String>::class.java,
            String::class.java
        )
        newProcess.isAccessible = true
        return newProcess.invoke(null, command, null, null) as Process
    }

    private fun collect(process: Process, timeoutMs: Long): CommandResult {
        val stdout = StreamCollector(process.inputStream)
        val stderr = StreamCollector(process.errorStream)
        stdout.start()
        stderr.start()
        val completed = process.waitFor(max(1L, timeoutMs), TimeUnit.MILLISECONDS)
        if (!completed) {
            val stdoutSnapshot = stdout.output()
            val payloadExitCode = exitCodeFromPayload(stdoutSnapshot)
            if (payloadExitCode != null) {
                process.destroy()
                stdout.join(1_000L)
                stderr.join(1_000L)
                return CommandResult(payloadExitCode, stdout.output(), stderr.output())
            }
            process.destroyForcibly()
            throw IllegalStateException("Timed out running Codey automator.")
        }
        stdout.join(1_000L)
        stderr.join(1_000L)
        val stdoutOutput = stdout.output()
        val exitCode = readExitCode(process, stdoutOutput)
        return CommandResult(exitCode, stdoutOutput, stderr.output())
    }

    private fun readExitCode(process: Process, stdout: String): Int {
        return try {
            process.exitValue()
        } catch (error: IllegalThreadStateException) {
            val payloadExitCode = exitCodeFromPayload(stdout)
            if (payloadExitCode != null) {
                payloadExitCode
            } else {
                process.destroyForcibly()
                throw IllegalStateException(
                    "Codey automator process finished output collection without an exit code.",
                    error
                )
            }
        }
    }

    private fun shellQuote(value: String): String {
        return "'" + value.replace("'", "'\\''") + "'"
    }

    private fun exitCodeFromPayload(output: String?): Int? {
        val payload = parsePayload(output) ?: return null
        if (!payload.has("ok")) {
            return null
        }
        return if (payload.optBoolean("ok", false)) 0 else 1
    }

    data class AutomatorRunResult(
        val ok: Boolean,
        val mode: String,
        val rootAttempt: CommandResult?,
        val commandResult: CommandResult?,
        val error: String?
    ) {
        val payload: JSONObject? = parsePayload(commandResult?.stdout)

        companion object {
            fun fromCommand(mode: String, commandResult: CommandResult): AutomatorRunResult {
                val payload = parsePayload(commandResult.stdout)
                val payloadError = payload?.optString("error")?.takeIf { it.isNotEmpty() }
                val ok = payload?.optBoolean("ok", false) == true
                val error = if (ok) {
                    null
                } else {
                    payloadError ?: (if (commandResult.stderr.isEmpty()) {
                        commandResult.stdout
                    } else {
                        commandResult.stderr
                    }).takeAtMost(240)
                }
                return AutomatorRunResult(
                    ok = ok,
                    mode = mode,
                    rootAttempt = null,
                    commandResult = commandResult,
                    error = error
                )
            }
        }
    }

    data class CommandResult(
        val exitCode: Int,
        val stdout: String,
        val stderr: String
    )

    data class AutomatorHostInstallResult(
        val installed: Boolean,
        val mode: String,
        val rootAttempt: CommandResult?,
        val shizukuAttempt: CommandResult?
    )

    private class StreamCollector(private val stream: InputStream) : Thread() {
        private val output = ByteArrayOutputStream()

        override fun run() {
            val buffer = ByteArray(4096)
            try {
                stream.use { input ->
                    while (true) {
                        val read = input.read(buffer)
                        if (read == -1) {
                            break
                        }
                        output.write(buffer, 0, read)
                    }
                }
            } catch (_: Exception) {
            }
        }

        fun output(): String = output.toString()
    }
}

private fun parsePayload(output: String?): JSONObject? {
    if (output == null) {
        return null
    }
    val lines = output.trim().split(Regex("\\r?\\n"))
    for (index in lines.indices.reversed()) {
        var line = lines[index].trim()
        line = when {
            line.startsWith("INSTRUMENTATION_RESULT: codey_result=") ->
                line.removePrefix("INSTRUMENTATION_RESULT: codey_result=").trim()
            line.startsWith("INSTRUMENTATION_STATUS: codey_result=") ->
                line.removePrefix("INSTRUMENTATION_STATUS: codey_result=").trim()
            else -> line
        }
        if (!line.startsWith("{") || !line.endsWith("}")) {
            continue
        }
        try {
            return JSONObject(line)
        } catch (_: Exception) {
        }
    }
    return null
}

private fun Throwable.safeInstallerMessage(): String {
    return message?.takeIf { it.isNotBlank() }
        ?: javaClass.simpleName
}
