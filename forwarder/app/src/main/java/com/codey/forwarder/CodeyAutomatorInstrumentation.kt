package com.codey.app

import android.app.Instrumentation
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import org.json.JSONObject
import kotlin.math.max

class CodeyAutomatorInstrumentation : Instrumentation() {
    private var arguments: Bundle = Bundle()

    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        this.arguments = arguments ?: Bundle()
        start()
    }

    override fun onStart() {
        super.onStart()
        runCommand(arguments)
    }

    private fun runCommand(arguments: Bundle) {
        var resultCode = 0
        val output = Bundle()
        val payload = try {
            val command = stringArg(arguments, "command", DEFAULT_COMMAND)
            if (DEFAULT_COMMAND != command) {
                throw IllegalArgumentException("Unknown automator command: $command")
            }
            val timeoutMs = longArg(arguments, "timeoutMs", DEFAULT_TIMEOUT_MS)
            SystemClock.sleep(250L)
            GoPayUnlinkUiAutomator(this, timeoutMs).run()
        } catch (error: Throwable) {
            resultCode = 1
            JSONObject().also { errorPayload ->
                try {
                    errorPayload.put("ok", false)
                    errorPayload.put("error", error.message ?: error.javaClass.simpleName)
                    errorPayload.put("errorClass", error.javaClass.name)
                } catch (_: Exception) {
                }
            }
        }

        output.putString("codey_result", payload.toString())
        output.putString("stream", payload.toString() + "\n")
        Log.i(TAG, payload.toString())
        sendStatus(0, output)
        finishSafely(resultCode, output)
    }

    private fun finishSafely(resultCode: Int, output: Bundle) {
        waitForUiAutomationIdle()
        repeat(20) {
            try {
                finish(resultCode, output)
                return
            } catch (error: IllegalStateException) {
                if (!isUiAutomationConnectingError(error)) {
                    throw error
                }
                SystemClock.sleep(100L)
            }
        }

        try {
            SystemClock.sleep(1_000L)
            finish(resultCode, output)
        } catch (error: IllegalStateException) {
            if (!isUiAutomationConnectingError(error)) {
                throw error
            }
            Log.e(TAG, "UiAutomation was still connecting while finishing instrumentation.", error)
        }
    }

    private fun waitForUiAutomationIdle() {
        try {
            uiAutomation.waitForIdle(100L, 2_000L)
        } catch (_: Throwable) {
        }
    }

    companion object {
        private const val TAG = "CodeyAutomator"
        private const val DEFAULT_COMMAND = "gopay-unlink"
        private const val DEFAULT_TIMEOUT_MS = 60_000L

        private fun isUiAutomationConnectingError(error: IllegalStateException): Boolean {
            return error.message?.contains(
                "Cannot call disconnect() while connecting UiAutomation"
            ) == true
        }

        private fun stringArg(arguments: Bundle, key: String, fallback: String): String {
            return arguments.getString(key)?.trim()?.ifEmpty { fallback } ?: fallback
        }

        private fun longArg(arguments: Bundle, key: String, fallback: Long): Long {
            val value = arguments.getString(key) ?: return fallback
            return try {
                max(1L, value.toLong())
            } catch (_: NumberFormatException) {
                fallback
            }
        }
    }
}
