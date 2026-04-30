import type { AndroidDriver, AndroidSession } from '../../core/android'
import { newAndroidSession } from '../../core/android'
import { sleep } from '../../utils/wait'

export const GOPAY_LINKED_APPS_ENTRY_XPATH =
  '//android.view.View[@content-desc="Linked apps\nList of apps that you link to GoPay"]'
export const GOPAY_LINKED_APPS_FUZZY_ENTRY_XPATH =
  '//*[contains(@content-desc, "Linked apps") and contains(@content-desc, "List of apps")]'
export const GOPAY_LINKED_APPS_TITLE_XPATH =
  '//android.view.View[@content-desc="Linked apps"]'
export const GOPAY_NO_LINKED_APPS_XPATH =
  '//*[contains(@content-desc, "No apps linked to your GoPay")]'
export const GOPAY_UNLINK_BUTTON_XPATH =
  '//android.widget.Button[@content-desc="Unlink"]'

const DEFAULT_GOPAY_UNLINK_TIMEOUT_MS = 60000
const GOPAY_UNLINK_POLL_MS = 500

export type GoPayAndroidUnlinkStatus = 'already-unlinked' | 'unlinked'

export type GoPayAndroidUnlinkProgressStep =
  | 'session-opened'
  | 'linked-apps-opened'
  | 'already-unlinked'
  | 'unlink-clicked'
  | 'unlink-confirmed'
  | 'completed'

export interface GoPayAndroidUnlinkProgress {
  step: GoPayAndroidUnlinkProgressStep
  message: string
}

export interface GoPayAndroidUnlinkResult {
  status: GoPayAndroidUnlinkStatus
  appiumSessionId?: string
  currentPackage?: string
  currentActivity?: string
  clickedLinkedApps: boolean
  clickedInitialUnlink: boolean
  clickedConfirmUnlink: boolean
}

export interface GoPayAndroidUnlinkOptions {
  timeoutMs?: number
  onProgress?: (update: GoPayAndroidUnlinkProgress) => void | Promise<void>
}

interface GoPayAndroidDriverElement {
  isDisplayed?: () => Promise<boolean> | boolean
  isEnabled?: () => Promise<boolean> | boolean
  click?: () => Promise<void> | void
}

export interface GoPayAndroidUnlinkDriver {
  $$: (
    selector: string,
  ) => Promise<GoPayAndroidDriverElement[]> | GoPayAndroidDriverElement[]
  getPageSource?: () => Promise<string> | string
  getCurrentPackage?: () => Promise<string> | string
  getCurrentActivity?: () => Promise<string> | string
  back?: () => Promise<void> | void
  pressKeyCode?: (keyCode: number) => Promise<void> | void
}

function asGoPayAndroidUnlinkDriver(
  driver: AndroidDriver,
): GoPayAndroidUnlinkDriver {
  return driver as unknown as GoPayAndroidUnlinkDriver
}

function resolveTimeoutMs(timeoutMs: number | undefined): number {
  return Math.max(1, timeoutMs ?? DEFAULT_GOPAY_UNLINK_TIMEOUT_MS)
}

function remainingMs(deadline: number): number {
  return Math.max(0, deadline - Date.now())
}

async function reportProgress(
  options: GoPayAndroidUnlinkOptions,
  update: GoPayAndroidUnlinkProgress,
): Promise<void> {
  await options.onProgress?.(update)
}

async function callOptionalDriverCommand(
  driver: GoPayAndroidUnlinkDriver,
  command: 'getCurrentPackage' | 'getCurrentActivity',
): Promise<string | undefined> {
  const fn = driver[command]
  if (typeof fn !== 'function') {
    return undefined
  }

  try {
    const value = await fn.call(driver)
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  } catch {
    return undefined
  }
}

async function readPageSource(
  driver: GoPayAndroidUnlinkDriver,
): Promise<string> {
  if (typeof driver.getPageSource !== 'function') {
    return ''
  }

  try {
    return String(await driver.getPageSource.call(driver))
  } catch {
    return ''
  }
}

async function isElementDisplayed(
  element: GoPayAndroidDriverElement,
): Promise<boolean> {
  if (typeof element.isDisplayed !== 'function') {
    return true
  }

  return Boolean(await element.isDisplayed())
}

async function isElementEnabled(
  element: GoPayAndroidDriverElement,
): Promise<boolean> {
  if (typeof element.isEnabled !== 'function') {
    return true
  }

  return Boolean(await element.isEnabled())
}

async function findDisplayedElements(
  driver: GoPayAndroidUnlinkDriver,
  xpath: string,
): Promise<GoPayAndroidDriverElement[]> {
  let elements: GoPayAndroidDriverElement[] = []
  try {
    elements = await driver.$$(xpath)
  } catch {
    elements = []
  }
  const displayed: GoPayAndroidDriverElement[] = []

  for (const element of elements) {
    if (await isElementDisplayed(element).catch(() => false)) {
      displayed.push(element)
    }
  }

  return displayed
}

async function hasDisplayedXPath(
  driver: GoPayAndroidUnlinkDriver,
  xpath: string,
): Promise<boolean> {
  return (await findDisplayedElements(driver, xpath)).length > 0
}

async function isLinkedAppsPage(
  driver: GoPayAndroidUnlinkDriver,
): Promise<boolean> {
  if (await hasDisplayedXPath(driver, GOPAY_LINKED_APPS_TITLE_XPATH)) {
    return true
  }

  const source = await readPageSource(driver)
  return /pane-title="Linked apps"/i.test(source)
}

function isSystemOverlayPageSource(source: string): boolean {
  return (
    /package="com\.android\.systemui"/i.test(source) ||
    /pane-title="Notification shade\."/i.test(source)
  )
}

async function dismissSystemOverlays(
  driver: GoPayAndroidUnlinkDriver,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const source = await readPageSource(driver)
    if (!isSystemOverlayPageSource(source)) {
      return
    }

    if (typeof driver.back === 'function') {
      await Promise.resolve(driver.back.call(driver)).catch(() => undefined)
    } else if (typeof driver.pressKeyCode === 'function') {
      await Promise.resolve(driver.pressKeyCode.call(driver, 4)).catch(
        () => undefined,
      )
    } else {
      return
    }
    await sleep(500)
  }
}

async function isNoLinkedAppsState(
  driver: GoPayAndroidUnlinkDriver,
): Promise<boolean> {
  if (await hasDisplayedXPath(driver, GOPAY_NO_LINKED_APPS_XPATH)) {
    return true
  }

  const source = await readPageSource(driver)
  return /No apps linked to your GoPay/i.test(source)
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  deadline: number,
): Promise<boolean> {
  do {
    if (await predicate()) {
      return true
    }

    const remaining = remainingMs(deadline)
    if (remaining <= 0) {
      break
    }
    await sleep(Math.min(GOPAY_UNLINK_POLL_MS, remaining))
  } while (Date.now() <= deadline)

  return predicate()
}

async function clickDisplayedXPath(
  driver: GoPayAndroidUnlinkDriver,
  xpath: string,
  input: {
    deadline: number
    description: string
    pick?: 'first' | 'last'
  },
): Promise<void> {
  do {
    const elements = await findDisplayedElements(driver, xpath)
    const enabled: GoPayAndroidDriverElement[] = []
    for (const element of elements) {
      if (await isElementEnabled(element).catch(() => false)) {
        enabled.push(element)
      }
    }

    const element = input.pick === 'last' ? enabled.at(-1) : enabled.at(0)
    if (element?.click) {
      await element.click()
      return
    }

    const remaining = remainingMs(input.deadline)
    if (remaining <= 0) {
      break
    }
    await sleep(Math.min(GOPAY_UNLINK_POLL_MS, remaining))
  } while (Date.now() <= input.deadline)

  throw new Error(`GoPay ${input.description} element was not visible.`)
}

async function openLinkedAppsPageIfNeeded(
  driver: GoPayAndroidUnlinkDriver,
  deadline: number,
): Promise<boolean> {
  if (await isLinkedAppsPage(driver)) {
    return false
  }

  const entryXPath = (await hasDisplayedXPath(
    driver,
    GOPAY_LINKED_APPS_ENTRY_XPATH,
  ))
    ? GOPAY_LINKED_APPS_ENTRY_XPATH
    : GOPAY_LINKED_APPS_FUZZY_ENTRY_XPATH

  await clickDisplayedXPath(driver, entryXPath, {
    deadline,
    description: 'Linked apps entry',
  })

  const opened = await waitUntil(() => isLinkedAppsPage(driver), deadline)
  if (!opened) {
    throw new Error('GoPay Linked apps page did not open.')
  }

  return true
}

export async function unlinkGoPayLinkedAppsInSession(
  session: Pick<AndroidSession, 'appiumSessionId' | 'driver'>,
  options: GoPayAndroidUnlinkOptions = {},
): Promise<GoPayAndroidUnlinkResult> {
  const timeoutMs = resolveTimeoutMs(options.timeoutMs)
  const deadline = Date.now() + timeoutMs
  const driver = asGoPayAndroidUnlinkDriver(session.driver)
  await dismissSystemOverlays(driver)
  const currentPackage = await callOptionalDriverCommand(
    driver,
    'getCurrentPackage',
  )
  const currentActivity = await callOptionalDriverCommand(
    driver,
    'getCurrentActivity',
  )
  const clickedLinkedApps = await openLinkedAppsPageIfNeeded(driver, deadline)

  await reportProgress(options, {
    step: 'linked-apps-opened',
    message: clickedLinkedApps
      ? 'Opened GoPay Linked apps page'
      : 'GoPay Linked apps page is already open',
  })

  if (await isNoLinkedAppsState(driver)) {
    await reportProgress(options, {
      step: 'already-unlinked',
      message: 'GoPay has no linked apps',
    })
    return {
      status: 'already-unlinked',
      appiumSessionId: session.appiumSessionId,
      currentPackage,
      currentActivity,
      clickedLinkedApps,
      clickedInitialUnlink: false,
      clickedConfirmUnlink: false,
    }
  }

  await clickDisplayedXPath(driver, GOPAY_UNLINK_BUTTON_XPATH, {
    deadline,
    description: 'initial Unlink button',
    pick: 'first',
  })
  await reportProgress(options, {
    step: 'unlink-clicked',
    message: 'Clicked GoPay linked app Unlink button',
  })

  await sleep(500)
  await clickDisplayedXPath(driver, GOPAY_UNLINK_BUTTON_XPATH, {
    deadline,
    description: 'confirmation Unlink button',
    pick: 'last',
  })
  await reportProgress(options, {
    step: 'unlink-confirmed',
    message: 'Confirmed GoPay linked app unlink',
  })

  const unlinked = await waitUntil(
    async () =>
      (await isNoLinkedAppsState(driver)) ||
      !(await hasDisplayedXPath(driver, GOPAY_UNLINK_BUTTON_XPATH)),
    deadline,
  )
  if (!unlinked) {
    throw new Error('GoPay linked app was still visible after unlink confirm.')
  }

  await reportProgress(options, {
    step: 'completed',
    message: 'GoPay linked app unlink completed',
  })

  return {
    status: 'unlinked',
    appiumSessionId: session.appiumSessionId,
    currentPackage,
    currentActivity,
    clickedLinkedApps,
    clickedInitialUnlink: true,
    clickedConfirmUnlink: true,
  }
}

export async function unlinkGoPayLinkedApps(
  options: GoPayAndroidUnlinkOptions = {},
): Promise<GoPayAndroidUnlinkResult> {
  const session = await newAndroidSession()

  try {
    await reportProgress(options, {
      step: 'session-opened',
      message: 'Appium GoPay unlink session opened',
    })
    return await unlinkGoPayLinkedAppsInSession(session, options)
  } finally {
    await session.close()
  }
}
