package com.codey.app

import android.content.Context
import org.json.JSONObject
import rikka.shizuku.Shizuku
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.lang.reflect.Method
import java.util.concurrent.TimeUnit
import kotlin.math.max

object CodeyAutomatorLauncher {
    private const val SHIZUKU_PERMISSION_REQUEST_CODE = 7721

    fun runGoPayUnlink(context: Context, timeoutMs: Long): AutomatorRunResult {
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
        if (root.exitCode == 0) {
            return AutomatorRunResult.fromCommand("root", root)
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

    private fun runLocalProcess(command: Array<String>, timeoutMs: Long): CommandResult {
        val process = ProcessBuilder(*command).start()
        return collect(process, timeoutMs)
    }

    private fun runShizukuProcess(command: Array<String>, timeoutMs: Long): CommandResult {
        val newProcess: Method = Shizuku::class.java.getDeclaredMethod(
            "newProcess",
            Array<String>::class.java,
            Array<String>::class.java,
            String::class.java
        )
        newProcess.isAccessible = true
        val process = newProcess.invoke(null, command, null, null) as Process
        return collect(process, timeoutMs)
    }

    private fun collect(process: Process, timeoutMs: Long): CommandResult {
        val stdout = StreamCollector(process.inputStream)
        val stderr = StreamCollector(process.errorStream)
        stdout.start()
        stderr.start()
        val completed = process.waitFor(max(1L, timeoutMs), TimeUnit.MILLISECONDS)
        if (!completed) {
            process.destroyForcibly()
            throw IllegalStateException("Timed out running Codey automator.")
        }
        stdout.join(1_000L)
        stderr.join(1_000L)
        return CommandResult(process.exitValue(), stdout.output(), stderr.output())
    }

    private fun shellQuote(value: String): String {
        return "'" + value.replace("'", "'\\''") + "'"
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
                val ok = commandResult.exitCode == 0 && payload?.optBoolean("ok", false) == true
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
