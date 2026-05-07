package com.codey.app

import android.app.Instrumentation
import android.content.Intent
import android.graphics.Rect
import android.os.SystemClock
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import org.json.JSONObject
import java.util.regex.Pattern
import kotlin.math.max
import kotlin.math.min

class GoPayUnlinkUiAutomator(
    private val instrumentation: Instrumentation,
    timeoutMs: Long
) {
    private val device: UiDevice = UiDevice.getInstance(instrumentation)
    private val timeoutMs = max(1L, timeoutMs)

    private var launchedGoPay = false
    private var clickedProfile = false
    private var clickedAccountSettings = false
    private var clickedLinkedApps = false
    private var clickedInitialUnlink = false
    private var clickedConfirmUnlink = false
    private var exitedLinkedApps = false

    fun run(): JSONObject {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        device.wakeUp()
        dismissSystemOverlays(deadline)
        val initialPackage = device.currentPackageName

        openLinkedAppsPageIfNeeded(deadline)

        if (!waitForLinkedAppsContent(deadline)) {
            throw linkedAppsContentTimeout()
        }

        var hasNoLinkedApps = isNoLinkedAppsState()
        var clickedLinkedAppsAfterRefresh = false

        if (hasNoLinkedApps) {
            reopenLinkedAppsPageFromParent(deadline)
            clickedLinkedAppsAfterRefresh = true
            if (!waitForLinkedAppsContent(deadline)) {
                throw linkedAppsContentTimeout()
            }
            hasNoLinkedApps = isNoLinkedAppsState()
        }

        if (hasNoLinkedApps) {
            exitedLinkedApps = exitLinkedAppsPage(deadline)
            return result(
                status = "already-unlinked",
                initialPackage = initialPackage,
                clickedLinkedAppsAfterRefresh = clickedLinkedAppsAfterRefresh,
                unlinkedAppCount = 0
            )
        }

        if (findUnlinkButtons().isEmpty() && !hasLinkedAppItem()) {
            throw linkedAppsContentTimeout()
        }

        val unlinkedAppCount = unlinkVisibleLinkedApps(deadline)
        return result(
            status = "unlinked",
            initialPackage = initialPackage,
            clickedLinkedAppsAfterRefresh = clickedLinkedAppsAfterRefresh,
            unlinkedAppCount = unlinkedAppCount
        )
    }

    private fun result(
        status: String,
        initialPackage: String?,
        clickedLinkedAppsAfterRefresh: Boolean,
        unlinkedAppCount: Int
    ): JSONObject {
        return JSONObject()
            .put("ok", true)
            .put("status", status)
            .put("automatorSessionId", "codey-uiautomator")
            .put("currentPackage", initialPackage)
            .put("currentActivity", JSONObject.NULL)
            .put("launchedGoPay", launchedGoPay)
            .put("clickedProfile", clickedProfile)
            .put("clickedAccountSettings", clickedAccountSettings)
            .put("clickedLinkedApps", clickedLinkedApps || clickedLinkedAppsAfterRefresh)
            .put("clickedInitialUnlink", clickedInitialUnlink)
            .put("clickedConfirmUnlink", clickedConfirmUnlink)
            .put("unlinkedAppCount", unlinkedAppCount)
            .put("exitedLinkedApps", exitedLinkedApps)
    }

    private fun openLinkedAppsPageIfNeeded(deadline: Long) {
        if (isLinkedAppsPage()) {
            return
        }

        if (!hasGoPayNavigationAnchor()) {
            launchedGoPay = launchGoPay(deadline)
        }

        if (isLinkedAppsPage()) {
            return
        }

        if (!hasAccountSettingsOrLinkedAppsEntry()) {
            clickAnyUntil(
                deadline = deadline,
                description = "GoPay Profile",
                selectors = selectors(descContains(PROFILE_PATTERN)),
                pickLast = false
            )
            clickedProfile = true
            waitUntil(deadline, ::hasAccountSettingsOrLinkedAppsEntry)
        }

        if (isLinkedAppsPage()) {
            return
        }

        if (!hasLinkedAppsEntry()) {
            clickAnyUntil(
                deadline = deadline,
                description = "GoPay Account & app settings",
                selectors = selectors(
                    descContains(ACCOUNT_SETTINGS_PATTERN),
                    textContains(ACCOUNT_SETTINGS_PATTERN)
                ),
                pickLast = false
            )
            clickedAccountSettings = true
            waitUntil(deadline, ::hasLinkedAppsEntry)
        }

        if (isLinkedAppsPage()) {
            return
        }

        clickAnyUntil(
            deadline = deadline,
            description = "GoPay Linked apps entry",
            selectors = selectors(
                descContains(LINKED_APPS_ENTRY_PATTERN),
                textContains(LINKED_APPS_ENTRY_PATTERN)
            ),
            pickLast = false
        )
        clickedLinkedApps = true
        if (!waitUntil(deadline, ::isLinkedAppsPage)) {
            throw IllegalStateException("GoPay Linked apps page did not open.")
        }
    }

    private fun unlinkVisibleLinkedApps(deadline: Long): Int {
        if (!waitForLinkedAppsContent(deadline)) {
            throw linkedAppsContentTimeout()
        }

        val buttons = findUnlinkButtons()
        if (buttons.isEmpty()) {
            if (hasLinkedAppItem()) {
                throw IllegalStateException(
                    "GoPay linked app is visible, but its Unlink button was not visible."
                )
            }
            throw linkedAppsContentTimeout()
        }

        clickObject(buttons[0])
        clickedInitialUnlink = true
        sleepUntil(deadline, CLICK_SETTLE_MS)

        clickAnyUntil(
            deadline = deadline,
            description = "GoPay confirmation Unlink button",
            selectors = selectors(descEquals(UNLINK_PATTERN), textEquals(UNLINK_PATTERN)),
            pickLast = true
        )
        clickedConfirmUnlink = true
        return 1
    }

    private fun launchGoPay(deadline: Long): Boolean {
        val context = instrumentation.context
        val intent = context.packageManager.getLaunchIntentForPackage(GOPAY_APP_PACKAGE)
            ?: throw IllegalStateException("GoPay launch intent was not found.")
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        device.wait(
            Until.hasObject(By.pkg(GOPAY_APP_PACKAGE).depth(0)),
            minRemaining(deadline, LAUNCH_TIMEOUT_MS)
        )
        sleepUntil(deadline, NAVIGATION_SETTLE_MS)
        return waitUntil(deadline, ::hasGoPayNavigationAnchor)
    }

    private fun dismissSystemOverlays(deadline: Long) {
        var attempt = 0
        while (attempt < 3 && remainingMs(deadline) > 0L) {
            val packageName = device.currentPackageName
            if (packageName == null || !packageName.contains("systemui")) {
                return
            }
            device.pressBack()
            sleepUntil(deadline, POLL_MS)
            attempt += 1
        }
    }

    private fun reopenLinkedAppsPageFromParent(deadline: Long): Boolean {
        if (!exitLinkedAppsPage(deadline)) {
            throw IllegalStateException("GoPay Linked apps page could not be exited.")
        }

        clickAnyUntil(
            deadline = deadline,
            description = "GoPay Linked apps entry",
            selectors = selectors(
                descContains(LINKED_APPS_ENTRY_PATTERN),
                textContains(LINKED_APPS_ENTRY_PATTERN)
            ),
            pickLast = false
        )
        clickedLinkedApps = true
        return waitUntil(deadline, ::isLinkedAppsPage)
    }

    private fun exitLinkedAppsPage(deadline: Long): Boolean {
        if (!isLinkedAppsPage()) {
            return false
        }

        val back = firstObject(selectors(descContains(BACK_PATTERN)))
        if (back != null) {
            clickObject(back)
        } else {
            device.pressBack()
        }

        if (waitUntil(deadline) { !isLinkedAppsPage() }) {
            return true
        }

        device.pressBack()
        return waitUntil(deadline) { !isLinkedAppsPage() }
    }

    private fun waitForLinkedAppsContent(deadline: Long): Boolean {
        return waitUntil(deadline) {
            isNoLinkedAppsState() || findUnlinkButtons().isNotEmpty() || hasLinkedAppItem()
        }
    }

    private fun hasGoPayNavigationAnchor(): Boolean {
        return isLinkedAppsPage() ||
            firstObject(selectors(descContains(PROFILE_PATTERN))) != null ||
            hasAccountSettingsOrLinkedAppsEntry()
    }

    private fun hasAccountSettingsOrLinkedAppsEntry(): Boolean {
        return firstObject(
            selectors(
                descContains(ACCOUNT_SETTINGS_PATTERN),
                textContains(ACCOUNT_SETTINGS_PATTERN)
            )
        ) != null || hasLinkedAppsEntry()
    }

    private fun hasLinkedAppsEntry(): Boolean {
        return firstObject(
            selectors(
                descContains(LINKED_APPS_ENTRY_PATTERN),
                textContains(LINKED_APPS_ENTRY_PATTERN)
            )
        ) != null
    }

    private fun isLinkedAppsPage(): Boolean {
        if (
            firstObject(
                selectors(
                    descEquals(LINKED_APPS_TITLE_PATTERN),
                    textEquals(LINKED_APPS_TITLE_PATTERN)
                )
            ) == null
        ) {
            return false
        }
        return firstObject(
            selectors(
                descContains(LINKED_APPS_ENTRY_PATTERN),
                textContains(LINKED_APPS_ENTRY_PATTERN)
            )
        ) == null || firstObject(selectors(descContains(BACK_PATTERN))) != null
    }

    private fun isNoLinkedAppsState(): Boolean {
        return firstObject(
            selectors(
                descContains(NO_LINKED_APPS_PATTERN),
                textContains(NO_LINKED_APPS_PATTERN)
            )
        ) != null
    }

    private fun hasLinkedAppItem(): Boolean {
        return firstObject(
            selectors(
                descContains(LINKED_ON_PATTERN),
                textContains(LINKED_ON_PATTERN)
            )
        ) != null
    }

    private fun findUnlinkButtons(): List<UiObject2> {
        val objects = device.findObjects(descEquals(UNLINK_PATTERN))
        if (objects.isNotEmpty()) {
            return objects
        }
        return device.findObjects(textEquals(UNLINK_PATTERN))
    }

    private fun clickAnyUntil(
        deadline: Long,
        description: String,
        selectors: List<BySelector>,
        pickLast: Boolean
    ) {
        do {
            val target = if (pickLast) lastObject(selectors) else firstObject(selectors)
            if (target != null) {
                clickObject(target)
                return
            }
            sleepUntil(deadline, POLL_MS)
        } while (remainingMs(deadline) > 0L)

        throw IllegalStateException("$description element was not visible.")
    }

    private fun firstObject(selectors: List<BySelector>): UiObject2? {
        for (selector in selectors) {
            val target = device.findObject(selector)
            if (target.isUsable()) {
                return target
            }
        }
        return null
    }

    private fun lastObject(selectors: List<BySelector>): UiObject2? {
        var fallback: UiObject2? = null
        for (selector in selectors) {
            val objects = device.findObjects(selector)
            for (target in objects) {
                if (target.isUsable()) {
                    fallback = target
                }
            }
        }
        return fallback
    }

    private fun clickObject(target: UiObject2) {
        if (!target.isUsable()) {
            throw IllegalStateException("Visible object was not clickable.")
        }
        target.click()
        SystemClock.sleep(CLICK_SETTLE_MS)
    }

    private fun waitUntil(deadline: Long, predicate: () -> Boolean): Boolean {
        do {
            if (predicate()) {
                return true
            }
            sleepUntil(deadline, POLL_MS)
        } while (remainingMs(deadline) > 0L)

        return predicate()
    }

    companion object {
        private const val GOPAY_APP_PACKAGE = "com.gojek.gopay"
        private const val POLL_MS = 500L
        private const val LAUNCH_TIMEOUT_MS = 10_000L
        private const val NAVIGATION_SETTLE_MS = 1_000L
        private const val CLICK_SETTLE_MS = 250L

        private val PROFILE_PATTERN: Pattern = Pattern.compile("(?i).*Profile.*")
        private val ACCOUNT_SETTINGS_PATTERN: Pattern = Pattern.compile(
            "(?is).*Account\\s*&\\s*app\\s*settings.*linked\\s*apps.*"
        )
        private val LINKED_APPS_ENTRY_PATTERN: Pattern = Pattern.compile(
            "(?is).*Linked\\s*apps.*List\\s*of\\s*apps.*"
        )
        private val LINKED_APPS_TITLE_PATTERN: Pattern =
            Pattern.compile("(?i)^Linked\\s+apps$")
        private val NO_LINKED_APPS_PATTERN: Pattern = Pattern.compile(
            "(?is).*No\\s+apps\\s+linked\\s+to\\s+your\\s+GoPay.*"
        )
        private val LINKED_ON_PATTERN: Pattern = Pattern.compile("(?is).*Linked\\s+on.*")
        private val UNLINK_PATTERN: Pattern = Pattern.compile("(?i)^Unlink$")
        private val BACK_PATTERN: Pattern = Pattern.compile("(?i).*Back.*")

        private fun UiObject2?.isUsable(): Boolean {
            if (this == null || !isEnabled) {
                return false
            }
            val bounds: Rect = visibleBounds
            return bounds.width() > 0 && bounds.height() > 0
        }

        private fun remainingMs(deadline: Long): Long {
            return max(0L, deadline - SystemClock.uptimeMillis())
        }

        private fun minRemaining(deadline: Long, capMs: Long): Long {
            return min(max(1L, capMs), max(1L, remainingMs(deadline)))
        }

        private fun sleepUntil(deadline: Long, ms: Long) {
            val sleepMs = min(ms, remainingMs(deadline))
            if (sleepMs > 0L) {
                SystemClock.sleep(sleepMs)
            }
        }

        private fun linkedAppsContentTimeout(): IllegalStateException {
            return IllegalStateException(
                "GoPay Linked apps content did not finish loading before timeout."
            )
        }

        private fun selectors(first: BySelector): List<BySelector> = listOf(first)

        private fun selectors(first: BySelector, second: BySelector): List<BySelector> {
            return listOf(first, second)
        }

        private fun descContains(pattern: Pattern): BySelector = By.desc(pattern)

        private fun descEquals(pattern: Pattern): BySelector = By.desc(pattern)

        private fun textContains(pattern: Pattern): BySelector = By.text(pattern)

        private fun textEquals(pattern: Pattern): BySelector = By.text(pattern)
    }
}
