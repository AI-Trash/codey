import type { Locator, Page } from 'patchright';
import type { SelectorList, SelectorTarget } from '../types';

export function toLocator(page: Page, target: SelectorTarget): Locator {
  if (!target) {
    throw new Error('Selector target is required');
  }

  if (typeof target === 'string') {
    return page.locator(target);
  }

  if ('css' in target) return page.locator(target.css);
  if ('role' in target) return page.getByRole(target.role, target.options || {});
  if ('text' in target) return page.getByText(target.text, target.options || {});
  if ('label' in target) return page.getByLabel(target.label, target.options || {});
  if ('placeholder' in target) return page.getByPlaceholder(target.placeholder, target.options || {});
  if ('testId' in target) return page.getByTestId(target.testId);

  throw new Error(`Unsupported selector target: ${JSON.stringify(target)}`);
}

export async function firstVisible(page: Page, targets: SelectorList): Promise<Locator> {
  if (!targets.length) {
    throw new Error('At least one selector target is required');
  }

  for (const target of targets) {
    const locator = toLocator(page, target).first();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }

  for (const target of targets) {
    const locator = toLocator(page, target).first();
    try {
      await locator.waitFor({ state: 'visible', timeout: 3000 });
      return locator;
    } catch {}
  }

  throw new Error(`None of the provided selectors became visible: ${JSON.stringify(targets)}`);
}
