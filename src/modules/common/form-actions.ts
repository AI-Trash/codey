import type { Page } from 'playwright';
import { firstVisible, toLocator } from '../../utils/selectors';
import type { SelectorList, SelectorTarget } from '../../types';

export async function clickAny(page: Page, selectors: SelectorList) {
  const locator = await firstVisible(page, selectors);
  await locator.click();
  return locator;
}

export async function fillIfPresent(page: Page, selector: SelectorTarget | SelectorList, value?: string) {
  if (value == null) return false;
  const target = Array.isArray(selector) ? selector[0] : selector;
  const locator = toLocator(page, target).first();
  await locator.waitFor({ state: 'visible' });
  await locator.fill(String(value));
  return true;
}

export async function clickIfPresent(page: Page, selectors: SelectorList): Promise<boolean> {
  for (const selector of selectors) {
    const locator = toLocator(page, selector).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.click();
      return true;
    }
  }
  return false;
}

export async function checkIfPresent(page: Page, selectors: SelectorList): Promise<boolean> {
  for (const selector of selectors) {
    const locator = toLocator(page, selector).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.check().catch(async () => locator.click());
      return true;
    }
  }
  return false;
}
