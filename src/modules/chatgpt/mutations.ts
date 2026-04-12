import type { Page } from "patchright";
import { clickAny, clickIfPresent, typeIfPresent } from "../common/form-actions";
import { sleep } from "../../utils/wait";
import {
  ADULT_AGE,
  AGE_CONFIRM_SELECTORS,
  AGE_GATE_AGE_SELECTORS,
  AGE_GATE_NAME_SELECTORS,
  CHATGPT_ENTRY_LOGIN_URL,
  CHATGPT_LOGIN_URL,
  CHATGPT_SECURITY_URL,
  COMPLETE_ACCOUNT_SELECTORS,
  LOGIN_CONTINUE_SELECTORS,
  LOGIN_EMAIL_SELECTORS,
  LOGIN_ENTRY_SELECTORS,
  ONBOARDING_ACTION_CANDIDATES,
  PASSKEY_ENTRY_SELECTORS,
  PASSKEY_DONE_SELECTORS,
  PASSWORD_SUBMIT_SELECTORS,
  PASSWORD_TIMEOUT_RETRY_SELECTORS,
  PROFILE_NAME,
  REGISTRATION_CONTINUE_SELECTORS,
  REGISTRATION_EMAIL_SELECTORS,
  SECURITY_ADD_SELECTORS,
  SIGNUP_ENTRY_SELECTORS,
} from "./common";
import type { SelectorTarget } from "../../types";
import { toLocator } from "../../utils/selectors";
import {
  waitForLoginEmailFormReady,
  waitForLoginEmailSubmissionOutcome,
} from "./queries";

export async function clickSignupEntry(page: Page): Promise<void> {
  await clickAny(page, SIGNUP_ENTRY_SELECTORS);
}

export async function gotoLoginEntry(page: Page): Promise<void> {
  await page.goto(CHATGPT_ENTRY_LOGIN_URL, { waitUntil: "domcontentloaded" });
  await page.locator("body").waitFor({ state: "visible" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

export async function clickLoginEntryIfPresent(page: Page): Promise<boolean> {
  return clickIfPresent(page, LOGIN_ENTRY_SELECTORS);
}

export async function typeRegistrationEmail(page: Page, email: string): Promise<boolean> {
  return typeIfPresent(page, REGISTRATION_EMAIL_SELECTORS, email);
}

export async function clickRegistrationContinue(page: Page): Promise<void> {
  await sleep(200);
  await clickAny(page, REGISTRATION_CONTINUE_SELECTORS);
}

export async function typePassword(page: Page, password: string): Promise<boolean> {
  return typeIfPresent(page, ['input[type="password"]', 'input[name="password"]'], password);
}

export async function clickPasswordSubmit(page: Page): Promise<void> {
  await sleep(200);
  await clickAny(page, PASSWORD_SUBMIT_SELECTORS);
}

export async function clickPasswordTimeoutRetry(page: Page): Promise<boolean> {
  for (const selector of PASSWORD_TIMEOUT_RETRY_SELECTORS) {
    const locator = toLocator(page, selector).first();
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    await locator.click();
    return true;
  }
  return false;
}

export async function typeVerificationCode(page: Page, code: string): Promise<void> {
  const input = page
    .locator(
      'input#_r_5_-code, input[autocomplete="one-time-code"], input[name="code"], input[name*="code"], input[id*="code"]',
    )
    .first();
  await input.fill(code);
}

export async function clickVerificationContinue(page: Page): Promise<boolean> {
  return clickIfPresent(page, [
    { role: "button", options: { name: /继续|continue|verify|验证/i } },
    { text: /继续|continue|verify|验证/i },
    'button[type="submit"]',
  ]);
}

async function fillFirstAvailable(
  page: Page,
  selectors: SelectorTarget[],
  value: string,
): Promise<boolean> {
  for (const selector of selectors) {
    const locator = toLocator(page, selector).first();
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    await locator.fill(value);
    await locator.blur().catch(() => undefined);
    return true;
  }
  return false;
}

export async function fillAgeGateName(page: Page): Promise<boolean> {
  return fillFirstAvailable(page, AGE_GATE_NAME_SELECTORS, PROFILE_NAME);
}

export async function fillAgeGateAge(page: Page): Promise<boolean> {
  return fillFirstAvailable(page, AGE_GATE_AGE_SELECTORS, ADULT_AGE);
}

export async function confirmAgeDialogIfPresent(page: Page): Promise<boolean> {
  const confirmed = await clickIfPresent(page, AGE_CONFIRM_SELECTORS);
  if (confirmed) {
    await Promise.any([
      page.waitForLoadState("domcontentloaded", { timeout: 5000 }),
      sleep(500),
    ]).catch(() => undefined);
  }
  return confirmed;
}

export async function clickCompleteAccountCreation(page: Page): Promise<boolean> {
  const clicked = await clickIfPresent(page, COMPLETE_ACCOUNT_SELECTORS);
  if (clicked) {
    await Promise.any([
      page.waitForLoadState("domcontentloaded", { timeout: 5000 }),
      sleep(500),
    ]).catch(() => undefined);
    await confirmAgeDialogIfPresent(page);
  }
  return clicked;
}

export async function clickOnboardingAction(page: Page): Promise<string | null> {
  for (const candidate of ONBOARDING_ACTION_CANDIDATES) {
    const clicked = await clickIfPresent(page, candidate.selectors as never);
    if (clicked) return candidate.text;
  }
  return null;
}

export async function gotoSecuritySettings(page: Page): Promise<void> {
  await page.goto(CHATGPT_SECURITY_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

export async function clickAddPasskey(page: Page): Promise<boolean> {
  return clickIfPresent(page, SECURITY_ADD_SELECTORS);
}

export async function clickPasskeyDoneIfPresent(page: Page): Promise<boolean> {
  return clickIfPresent(page, PASSKEY_DONE_SELECTORS);
}

export async function typeLoginEmail(page: Page, email: string): Promise<boolean> {
  return typeIfPresent(page, LOGIN_EMAIL_SELECTORS, email);
}

export async function clickLoginContinue(page: Page): Promise<boolean> {
  return clickIfPresent(page, LOGIN_CONTINUE_SELECTORS);
}

export async function clickPasskeyEntry(page: Page): Promise<boolean> {
  return clickIfPresent(page, PASSKEY_ENTRY_SELECTORS);
}

export async function submitLoginEmail(page: Page, email: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const formReady = await waitForLoginEmailFormReady(page, 15000);
    if (!formReady) {
      throw new Error("ChatGPT login page did not finish rendering a stable email form.");
    }

    const filled = await typeLoginEmail(page, email);
    if (!filled) {
      throw new Error("ChatGPT login email field was visible but could not be filled.");
    }

    const submitted = await clickLoginContinue(page);
    if (!submitted) {
      throw new Error("ChatGPT login page did not expose a clickable continue button.");
    }

    const outcome = await waitForLoginEmailSubmissionOutcome(page);
    if (outcome === "next" || outcome === "unknown") return;

    const retried = await clickPasswordTimeoutRetry(page);
    if (!retried) {
      throw new Error("Login email submission timed out and retry button was not clickable.");
    }
  }

  throw new Error("Login email submission timed out repeatedly.");
}

async function clearOriginStorage(page: Page, originUrl: string): Promise<void> {
  await page.goto(originUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  await page
    .evaluate(async () => {
      try {
        window.localStorage.clear();
      } catch {}
      try {
        window.sessionStorage.clear();
      } catch {}
      try {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map((key) => caches.delete(key)));
      } catch {}
      try {
        const dbs = await indexedDB.databases?.();
        if (dbs?.length) {
          await Promise.all(
            dbs
              .map((db) => db.name)
              .filter((name): name is string => Boolean(name))
              .map(
                (name) =>
                  new Promise<void>((resolve) => {
                    const request = indexedDB.deleteDatabase(name);
                    request.onsuccess = () => resolve();
                    request.onerror = () => resolve();
                    request.onblocked = () => resolve();
                  }),
              ),
          );
        }
      } catch {}
    })
    .catch(() => undefined);
}

export async function clearAuthenticatedSessionState(page: Page): Promise<void> {
  await page
    .context()
    .clearCookies()
    .catch(() => undefined);
  await clearOriginStorage(page, CHATGPT_HOME_URL);
  await clearOriginStorage(page, CHATGPT_LOGIN_URL);
  await clearOriginStorage(page, CHATGPT_ENTRY_LOGIN_URL);
}
