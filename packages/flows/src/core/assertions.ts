import type { Locator, Page } from "patchright";

export async function expectVisible(locator: Locator, message?: string): Promise<void> {
  await locator.waitFor({ state: "visible" });
  if (!(await locator.isVisible())) {
    throw new Error(message || "Expected locator to be visible");
  }
}

export async function expectUrlIncludes(page: Page, expected: string): Promise<void> {
  const current = page.url();
  if (!current.includes(expected)) {
    throw new Error(`Expected URL to include "${expected}", got "${current}"`);
  }
}
