import type { Locator, Page } from 'patchright';
import { firstVisible, toLocator } from '../../utils/selectors';
import type { SelectorList, SelectorTarget } from '../../types';
import { sleep } from '../../utils/wait';

export async function clickAny(page: Page, selectors: SelectorList) {
  const locator = await firstVisible(page, selectors);
  await locator.click();
  return locator;
}

export async function fillIfPresent(page: Page, selector: SelectorTarget | SelectorList, value?: string) {
  if (value == null) return false;
  const locator = await resolveVisibleLocator(page, selector);
  await locator.fill(String(value));
  return true;
}

export async function typeIfPresent(page: Page, selector: SelectorTarget | SelectorList, value?: string) {
  if (value == null) return false;
  const locator = await resolveEditableLocator(page, selector);
  if (!locator) return false;

  await locator.click({ delay: randomBetween(60, 140) }).catch(() => undefined);
  await locator.fill('');
  await sleep(randomBetween(120, 240));

  for (const char of String(value)) {
    await locator.pressSequentially(char, { delay: randomBetween(45, 110) });
    if (Math.random() < 0.18) {
      await sleep(randomBetween(90, 260));
    }
  }

  await sleep(randomBetween(80, 180));
  await locator.blur().catch(() => undefined);
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

async function resolveVisibleLocator(page: Page, selector: SelectorTarget | SelectorList): Promise<Locator> {
  if (Array.isArray(selector)) {
    return firstVisible(page, selector);
  }

  const locator = toLocator(page, selector).first();
  await locator.waitFor({ state: 'visible' });
  return locator;
}

async function resolveEditableLocator(page: Page, selector: SelectorTarget | SelectorList): Promise<Locator | null> {
  const targets = Array.isArray(selector) ? selector : [selector];
  const visibleCandidates: Locator[] = [];

  for (const target of targets) {
    const locator = toLocator(page, target).first();
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    visibleCandidates.push(locator);
    if (await isEditableLocator(locator)) return locator;
  }

  for (const locator of visibleCandidates) {
    if (await isEditableLocator(locator)) return locator;
  }

  try {
    const locator = await resolveVisibleLocator(page, selector);
    if (await isEditableLocator(locator)) return locator;
  } catch {}

  return null;
}

async function isEditableLocator(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const candidate = element as HTMLInputElement | HTMLTextAreaElement;
    const htmlElement = element as HTMLElement & { disabled?: boolean };
    return !candidate.readOnly && !htmlElement.disabled && htmlElement.getAttribute('aria-disabled') !== 'true';
  }).catch(async () => locator.isEditable().catch(() => false));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
