package com.codey.app;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.graphics.Rect;
import android.os.SystemClock;

import androidx.test.uiautomator.By;
import androidx.test.uiautomator.BySelector;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;

import org.json.JSONObject;

import java.util.List;
import java.util.regex.Pattern;

final class GoPayUnlinkUiAutomator {
    private static final String GOPAY_APP_PACKAGE = "com.gojek.gopay";
    private static final long POLL_MS = 500L;
    private static final long LAUNCH_TIMEOUT_MS = 10_000L;
    private static final long NAVIGATION_SETTLE_MS = 1_000L;
    private static final long CLICK_SETTLE_MS = 250L;
    private static final Pattern PROFILE_PATTERN = Pattern.compile("(?i).*Profile.*");
    private static final Pattern ACCOUNT_SETTINGS_PATTERN = Pattern.compile(
        "(?is).*Account\\s*&\\s*app\\s*settings.*linked\\s*apps.*"
    );
    private static final Pattern LINKED_APPS_ENTRY_PATTERN = Pattern.compile(
        "(?is).*Linked\\s*apps.*List\\s*of\\s*apps.*"
    );
    private static final Pattern LINKED_APPS_TITLE_PATTERN = Pattern.compile("(?i)^Linked\\s+apps$");
    private static final Pattern NO_LINKED_APPS_PATTERN = Pattern.compile(
        "(?is).*No\\s+apps\\s+linked\\s+to\\s+your\\s+GoPay.*"
    );
    private static final Pattern LINKED_ON_PATTERN = Pattern.compile("(?is).*Linked\\s+on.*");
    private static final Pattern UNLINK_PATTERN = Pattern.compile("(?i)^Unlink$");
    private static final Pattern BACK_PATTERN = Pattern.compile("(?i).*Back.*");

    private final Instrumentation instrumentation;
    private final UiDevice device;
    private final long timeoutMs;
    private boolean launchedGoPay;
    private boolean clickedProfile;
    private boolean clickedAccountSettings;
    private boolean clickedLinkedApps;
    private boolean clickedInitialUnlink;
    private boolean clickedConfirmUnlink;
    private boolean exitedLinkedApps;

    GoPayUnlinkUiAutomator(Instrumentation instrumentation, long timeoutMs) {
        this.instrumentation = instrumentation;
        this.device = UiDevice.getInstance(instrumentation);
        this.timeoutMs = Math.max(1L, timeoutMs);
    }

    JSONObject run() throws Exception {
        long deadline = SystemClock.uptimeMillis() + timeoutMs;
        device.wakeUp();
        dismissSystemOverlays(deadline);
        String initialPackage = device.getCurrentPackageName();

        openLinkedAppsPageIfNeeded(deadline);

        if (!waitForLinkedAppsContent(deadline)) {
            throw linkedAppsContentTimeout();
        }

        boolean hasNoLinkedApps = isNoLinkedAppsState();
        boolean clickedLinkedAppsAfterRefresh = false;

        if (hasNoLinkedApps) {
            reopenLinkedAppsPageFromParent(deadline);
            clickedLinkedAppsAfterRefresh = true;
            if (!waitForLinkedAppsContent(deadline)) {
                throw linkedAppsContentTimeout();
            }
            hasNoLinkedApps = isNoLinkedAppsState();
        }

        if (hasNoLinkedApps) {
            exitedLinkedApps = exitLinkedAppsPage(deadline);
            return result(
                "already-unlinked",
                initialPackage,
                clickedLinkedAppsAfterRefresh,
                0
            );
        }

        if (findUnlinkButtons().isEmpty() && !hasLinkedAppItem()) {
            throw linkedAppsContentTimeout();
        }

        int unlinkedAppCount = unlinkVisibleLinkedApps(deadline);
        return result("unlinked", initialPackage, clickedLinkedAppsAfterRefresh, unlinkedAppCount);
    }

    private JSONObject result(
        String status,
        String initialPackage,
        boolean clickedLinkedAppsAfterRefresh,
        int unlinkedAppCount
    ) throws Exception {
        return new JSONObject()
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
            .put("exitedLinkedApps", exitedLinkedApps);
    }

    private void openLinkedAppsPageIfNeeded(long deadline) throws Exception {
        if (isLinkedAppsPage()) {
            return;
        }

        if (!hasGoPayNavigationAnchor()) {
            launchedGoPay = launchGoPay(deadline);
        }

        if (isLinkedAppsPage()) {
            return;
        }

        if (!hasAccountSettingsOrLinkedAppsEntry()) {
            clickAnyUntil(
                deadline,
                "GoPay Profile",
                selectors(descContains(PROFILE_PATTERN)),
                false
            );
            clickedProfile = true;
            waitUntil(deadline, this::hasAccountSettingsOrLinkedAppsEntry);
        }

        if (isLinkedAppsPage()) {
            return;
        }

        if (!hasLinkedAppsEntry()) {
            clickAnyUntil(
                deadline,
                "GoPay Account & app settings",
                selectors(descContains(ACCOUNT_SETTINGS_PATTERN), textContains(ACCOUNT_SETTINGS_PATTERN)),
                false
            );
            clickedAccountSettings = true;
            waitUntil(deadline, this::hasLinkedAppsEntry);
        }

        if (isLinkedAppsPage()) {
            return;
        }

        clickAnyUntil(
            deadline,
            "GoPay Linked apps entry",
            selectors(descContains(LINKED_APPS_ENTRY_PATTERN), textContains(LINKED_APPS_ENTRY_PATTERN)),
            false
        );
        clickedLinkedApps = true;
        if (!waitUntil(deadline, this::isLinkedAppsPage)) {
            throw new IllegalStateException("GoPay Linked apps page did not open.");
        }
    }

    private int unlinkVisibleLinkedApps(long deadline) throws Exception {
        if (!waitForLinkedAppsContent(deadline)) {
            throw linkedAppsContentTimeout();
        }

        List<UiObject2> buttons = findUnlinkButtons();
        if (buttons.isEmpty()) {
            if (hasLinkedAppItem()) {
                throw new IllegalStateException(
                    "GoPay linked app is visible, but its Unlink button was not visible."
                );
            }
            throw linkedAppsContentTimeout();
        }

        clickObject(buttons.get(0));
        clickedInitialUnlink = true;
        sleepUntil(deadline, CLICK_SETTLE_MS);

        clickAnyUntil(
            deadline,
            "GoPay confirmation Unlink button",
            selectors(descEquals(UNLINK_PATTERN), textEquals(UNLINK_PATTERN)),
            true
        );
        clickedConfirmUnlink = true;
        return 1;
    }

    private boolean launchGoPay(long deadline) {
        Context context = instrumentation.getTargetContext();
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(GOPAY_APP_PACKAGE);
        if (intent == null) {
            throw new IllegalStateException("GoPay launch intent was not found.");
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK | Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
        device.wait(Until.hasObject(By.pkg(GOPAY_APP_PACKAGE).depth(0)), minRemaining(deadline, LAUNCH_TIMEOUT_MS));
        sleepUntil(deadline, NAVIGATION_SETTLE_MS);
        return waitUntil(deadline, this::hasGoPayNavigationAnchor);
    }

    private void dismissSystemOverlays(long deadline) {
        for (int attempt = 0; attempt < 3 && remainingMs(deadline) > 0L; attempt += 1) {
            String packageName = device.getCurrentPackageName();
            if (packageName == null || !packageName.contains("systemui")) {
                return;
            }
            device.pressBack();
            sleepUntil(deadline, POLL_MS);
        }
    }

    private boolean reopenLinkedAppsPageFromParent(long deadline) throws Exception {
        if (!exitLinkedAppsPage(deadline)) {
            throw new IllegalStateException("GoPay Linked apps page could not be exited.");
        }

        clickAnyUntil(
            deadline,
            "GoPay Linked apps entry",
            selectors(descContains(LINKED_APPS_ENTRY_PATTERN), textContains(LINKED_APPS_ENTRY_PATTERN)),
            false
        );
        clickedLinkedApps = true;
        return waitUntil(deadline, this::isLinkedAppsPage);
    }

    private boolean exitLinkedAppsPage(long deadline) {
        if (!isLinkedAppsPage()) {
            return false;
        }

        UiObject2 back = firstObject(selectors(descContains(BACK_PATTERN)));
        if (back != null) {
            clickObject(back);
        } else {
            device.pressBack();
        }

        if (waitUntil(deadline, () -> !isLinkedAppsPage())) {
            return true;
        }

        device.pressBack();
        return waitUntil(deadline, () -> !isLinkedAppsPage());
    }

    private boolean waitForLinkedAppsContent(long deadline) {
        return waitUntil(deadline, () ->
            isNoLinkedAppsState() || !findUnlinkButtons().isEmpty() || hasLinkedAppItem()
        );
    }

    private boolean hasGoPayNavigationAnchor() {
        return isLinkedAppsPage() ||
            firstObject(selectors(descContains(PROFILE_PATTERN))) != null ||
            hasAccountSettingsOrLinkedAppsEntry();
    }

    private boolean hasAccountSettingsOrLinkedAppsEntry() {
        return firstObject(selectors(descContains(ACCOUNT_SETTINGS_PATTERN), textContains(ACCOUNT_SETTINGS_PATTERN))) != null ||
            hasLinkedAppsEntry();
    }

    private boolean hasLinkedAppsEntry() {
        return firstObject(selectors(descContains(LINKED_APPS_ENTRY_PATTERN), textContains(LINKED_APPS_ENTRY_PATTERN))) != null;
    }

    private boolean isLinkedAppsPage() {
        if (firstObject(selectors(descEquals(LINKED_APPS_TITLE_PATTERN), textEquals(LINKED_APPS_TITLE_PATTERN))) == null) {
            return false;
        }
        return firstObject(selectors(descContains(LINKED_APPS_ENTRY_PATTERN), textContains(LINKED_APPS_ENTRY_PATTERN))) == null ||
            firstObject(selectors(descContains(BACK_PATTERN))) != null;
    }

    private boolean isNoLinkedAppsState() {
        return firstObject(selectors(descContains(NO_LINKED_APPS_PATTERN), textContains(NO_LINKED_APPS_PATTERN))) != null;
    }

    private boolean hasLinkedAppItem() {
        return firstObject(selectors(descContains(LINKED_ON_PATTERN), textContains(LINKED_ON_PATTERN))) != null;
    }

    private List<UiObject2> findUnlinkButtons() {
        List<UiObject2> objects = device.findObjects(descEquals(UNLINK_PATTERN));
        if (!objects.isEmpty()) {
            return objects;
        }
        return device.findObjects(textEquals(UNLINK_PATTERN));
    }

    private void clickAnyUntil(
        long deadline,
        String description,
        List<BySelector> selectors,
        boolean pickLast
    ) {
        do {
            UiObject2 object = pickLast ? lastObject(selectors) : firstObject(selectors);
            if (object != null) {
                clickObject(object);
                return;
            }
            sleepUntil(deadline, POLL_MS);
        } while (remainingMs(deadline) > 0L);

        throw new IllegalStateException(description + " element was not visible.");
    }

    private UiObject2 firstObject(List<BySelector> selectors) {
        for (BySelector selector : selectors) {
            UiObject2 object = device.findObject(selector);
            if (isUsable(object)) {
                return object;
            }
        }
        return null;
    }

    private UiObject2 lastObject(List<BySelector> selectors) {
        UiObject2 fallback = null;
        for (BySelector selector : selectors) {
            List<UiObject2> objects = device.findObjects(selector);
            for (UiObject2 object : objects) {
                if (isUsable(object)) {
                    fallback = object;
                }
            }
        }
        return fallback;
    }

    private void clickObject(UiObject2 object) {
        if (!isUsable(object)) {
            throw new IllegalStateException("Visible object was not clickable.");
        }
        object.click();
        SystemClock.sleep(CLICK_SETTLE_MS);
    }

    private static boolean isUsable(UiObject2 object) {
        if (object == null || !object.isEnabled()) {
            return false;
        }
        Rect bounds = object.getVisibleBounds();
        return bounds != null && bounds.width() > 0 && bounds.height() > 0;
    }

    private boolean waitUntil(long deadline, CheckedBooleanSupplier predicate) {
        do {
            if (predicate.getAsBoolean()) {
                return true;
            }
            sleepUntil(deadline, POLL_MS);
        } while (remainingMs(deadline) > 0L);

        return predicate.getAsBoolean();
    }

    private static long remainingMs(long deadline) {
        return Math.max(0L, deadline - SystemClock.uptimeMillis());
    }

    private static long minRemaining(long deadline, long capMs) {
        return Math.min(Math.max(1L, capMs), Math.max(1L, remainingMs(deadline)));
    }

    private static void sleepUntil(long deadline, long ms) {
        long sleepMs = Math.min(ms, remainingMs(deadline));
        if (sleepMs > 0L) {
            SystemClock.sleep(sleepMs);
        }
    }

    private static IllegalStateException linkedAppsContentTimeout() {
        return new IllegalStateException(
            "GoPay Linked apps content did not finish loading before timeout."
        );
    }

    private static List<BySelector> selectors(BySelector first) {
        return java.util.Collections.singletonList(first);
    }

    private static List<BySelector> selectors(BySelector first, BySelector second) {
        return java.util.Arrays.asList(first, second);
    }

    private static BySelector descContains(Pattern pattern) {
        return By.desc(pattern);
    }

    private static BySelector descEquals(Pattern pattern) {
        return By.desc(pattern);
    }

    private static BySelector textContains(Pattern pattern) {
        return By.text(pattern);
    }

    private static BySelector textEquals(Pattern pattern) {
        return By.text(pattern);
    }

    private interface CheckedBooleanSupplier {
        boolean getAsBoolean();
    }
}
