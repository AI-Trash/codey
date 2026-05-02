import type { AndroidDriver, AndroidSession } from '../../core/android'
import { newAndroidSession } from '../../core/android'
import { sleep } from '../../utils/wait'

export const GOPAY_APP_PACKAGE = 'com.gojek.gopay'
export const GOPAY_MAIN_ACTIVITY = '.MainActivity'
export const GOPAY_PROFILE_XPATH =
  '//android.widget.ImageView[@content-desc="Profile"]'
export const GOPAY_PROFILE_FUZZY_XPATH =
  '//*[contains(@content-desc, "Profile")]'
export const GOPAY_ACCOUNT_APP_SETTINGS_XPATH =
  '//android.view.View[@content-desc="Account & app settings\nControl your app preferences, data, linked apps and more."]'
export const GOPAY_ACCOUNT_APP_SETTINGS_FUZZY_XPATH =
  '//*[contains(@content-desc, "Account & app settings") and contains(@content-desc, "linked apps")]'
export const GOPAY_LINKED_APPS_ENTRY_XPATH =
  '//android.view.View[@content-desc="Linked apps\nList of apps that you link to GoPay"]'
export const GOPAY_LINKED_APPS_ENTRY_XML_ENTITY_XPATH =
  '//android.view.View[@content-desc="Linked apps&#10;List of apps that you link to GoPay"]'
export const GOPAY_LINKED_APPS_FUZZY_ENTRY_XPATH =
  '//*[contains(@content-desc, "Linked apps") and contains(@content-desc, "List of apps")]'
export const GOPAY_LINKED_APPS_TITLE_XPATH =
  '//android.view.View[@content-desc="Linked apps"]'
export const GOPAY_LINKED_APPS_BACK_BUTTON_XPATH =
  '//android.widget.FrameLayout[@resource-id="android:id/content"]/android.widget.FrameLayout/android.widget.FrameLayout/android.view.View/android.view.View/android.view.View/android.view.View[1]/android.widget.Button'
export const GOPAY_LINKED_APPS_BACK_BUTTON_FUZZY_XPATH =
  '//android.widget.Button[.//*[@content-desc="Back"]]'
export const GOPAY_BACK_IMAGE_XPATH =
  '//android.widget.ImageView[@content-desc="Back"]'
export const GOPAY_NO_LINKED_APPS_XPATH =
  '//*[contains(@content-desc, "No apps linked to your GoPay")]'
export const GOPAY_LINKED_APP_ITEM_XPATH =
  '//*[contains(@content-desc, "Linked on")]'
export const GOPAY_UNLINK_BUTTON_XPATH =
  '//android.widget.Button[@content-desc="Unlink"]'

const DEFAULT_GOPAY_UNLINK_TIMEOUT_MS = 60000
const GOPAY_UNLINK_POLL_MS = 500
const GOPAY_NAVIGATION_SETTLE_MS = 1000
const GOPAY_CONFIRM_SETTLE_MS = 250

export type GoPayAndroidUnlinkStatus = 'already-unlinked' | 'unlinked'

export type GoPayAndroidUnlinkProgressStep =
  | 'session-opened'
  | 'gopay-opened'
  | 'profile-opened'
  | 'account-settings-opened'
  | 'linked-apps-opened'
  | 'already-unlinked'
  | 'unlink-clicked'
  | 'unlink-confirmed'
  | 'linked-apps-exited'
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
  launchedGoPay: boolean
  clickedProfile: boolean
  clickedAccountSettings: boolean
  clickedLinkedApps: boolean
  clickedInitialUnlink: boolean
  clickedConfirmUnlink: boolean
  unlinkedAppCount: number
  exitedLinkedApps: boolean
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
  startActivity?: (
    appPackage: string,
    appActivity: string,
  ) => Promise<void> | void
  activateApp?: (appId: string) => Promise<void> | void
  terminateApp?: (appId: string) => Promise<void> | void
  execute?: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  back?: () => Promise<void> | void
  pressKeyCode?: (keyCode: number) => Promise<void> | void
}

interface GoPayLinkedAppsNavigationResult {
  launchedGoPay: boolean
  clickedProfile: boolean
  clickedAccountSettings: boolean
  clickedLinkedApps: boolean
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

async function callOptionalStartActivity(
  driver: GoPayAndroidUnlinkDriver,
  appPackage: string,
  appActivity: string,
): Promise<boolean> {
  const fn = driver.startActivity
  if (typeof fn !== 'function') {
    return false
  }

  try {
    await fn.call(driver, appPackage, appActivity)
    return true
  } catch {
    return false
  }
}

async function callOptionalAppCommand(
  driver: GoPayAndroidUnlinkDriver,
  command: 'activateApp' | 'terminateApp',
  appId: string,
): Promise<boolean> {
  const fn = driver[command]
  if (typeof fn !== 'function') {
    return false
  }

  try {
    await fn.call(driver, appId)
    return true
  } catch {
    return false
  }
}

async function callOptionalExecuteCommand(
  driver: GoPayAndroidUnlinkDriver,
  command: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  if (typeof driver.execute !== 'function') {
    return false
  }

  try {
    await driver.execute(command, args)
    return true
  } catch {
    return false
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

async function hasAnyDisplayedXPath(
  driver: GoPayAndroidUnlinkDriver,
  xpaths: readonly string[],
): Promise<boolean> {
  for (const xpath of xpaths) {
    if (await hasDisplayedXPath(driver, xpath)) {
      return true
    }
  }

  return false
}

async function clickAnyDisplayedXPath(
  driver: GoPayAndroidUnlinkDriver,
  xpaths: readonly string[],
  pick: 'first' | 'last' = 'first',
): Promise<string | undefined> {
  for (const xpath of xpaths) {
    const elements = await findDisplayedElements(driver, xpath)
    const enabled: GoPayAndroidDriverElement[] = []
    for (const element of elements) {
      if (await isElementEnabled(element).catch(() => false)) {
        enabled.push(element)
      }
    }

    const element = pick === 'last' ? enabled.at(-1) : enabled.at(0)
    if (element?.click) {
      await element.click()
      return xpath
    }
  }

  return undefined
}

async function clickAnyDisplayedXPathUntil(
  driver: GoPayAndroidUnlinkDriver,
  xpaths: readonly string[],
  input: {
    deadline: number
    description: string
    pick?: 'first' | 'last'
  },
): Promise<string> {
  do {
    const clicked = await clickAnyDisplayedXPath(driver, xpaths, input.pick)
    if (clicked) {
      return clicked
    }

    const remaining = remainingMs(input.deadline)
    if (remaining <= 0) {
      break
    }
    await sleep(Math.min(GOPAY_UNLINK_POLL_MS, remaining))
  } while (Date.now() <= input.deadline)

  throw new Error(`GoPay ${input.description} element was not visible.`)
}

async function isLinkedAppsPage(
  driver: GoPayAndroidUnlinkDriver,
): Promise<boolean> {
  const source = await readPageSource(driver)
  if (source) {
    if (/pane-title="Linked apps"/i.test(source)) {
      return true
    }

    if (/pane-title="/i.test(source)) {
      return false
    }

    return (
      /<android\.view\.View\b(?=[^>]*content-desc="Linked apps")(?=[^>]*heading="true")/i.test(
        source,
      ) &&
      !/content-desc="Linked apps(?:&#10;|\n)List of apps that you link to GoPay"/i.test(
        source,
      )
    )
  }

  if (
    await hasAnyDisplayedXPath(driver, [
      GOPAY_LINKED_APPS_ENTRY_XPATH,
      GOPAY_LINKED_APPS_ENTRY_XML_ENTITY_XPATH,
      GOPAY_LINKED_APPS_FUZZY_ENTRY_XPATH,
    ])
  ) {
    return false
  }

  return hasDisplayedXPath(driver, GOPAY_LINKED_APPS_TITLE_XPATH)
}

async function isGoPayForeground(
  driver: GoPayAndroidUnlinkDriver,
): Promise<boolean> {
  const currentPackage = await callOptionalDriverCommand(
    driver,
    'getCurrentPackage',
  )
  if (currentPackage === GOPAY_APP_PACKAGE) {
    return true
  }

  const source = await readPageSource(driver)
  return new RegExp(`package="${GOPAY_APP_PACKAGE.replaceAll('.', '\\.')}"`, 'i')
    .test(source)
}

async function hasGoPayNavigationAnchor(
  driver: GoPayAndroidUnlinkDriver,
): Promise<boolean> {
  return (
    (await isLinkedAppsPage(driver)) ||
    (await hasAnyDisplayedXPath(driver, [
      GOPAY_PROFILE_XPATH,
      GOPAY_PROFILE_FUZZY_XPATH,
      GOPAY_ACCOUNT_APP_SETTINGS_XPATH,
      GOPAY_ACCOUNT_APP_SETTINGS_FUZZY_XPATH,
      GOPAY_LINKED_APPS_ENTRY_XPATH,
      GOPAY_LINKED_APPS_ENTRY_XML_ENTITY_XPATH,
      GOPAY_LINKED_APPS_FUZZY_ENTRY_XPATH,
    ]))
  )
}

async function waitForGoPayNavigationAnchor(
  driver: GoPayAndroidUnlinkDriver,
  deadline: number,
): Promise<boolean> {
  return waitUntil(() => hasGoPayNavigationAnchor(driver), deadline)
}

async function launchGoPayMainActivityIfNeeded(
  driver: GoPayAndroidUnlinkDriver,
  deadline: number,
): Promise<boolean> {
  if (await hasGoPayNavigationAnchor(driver)) {
    return false
  }

  const launchAttempts = [
    () =>
      callOptionalStartActivity(
        driver,
        GOPAY_APP_PACKAGE,
        GOPAY_MAIN_ACTIVITY,
      ),
    () =>
      callOptionalExecuteCommand(driver, 'mobile: startActivity', {
        appPackage: GOPAY_APP_PACKAGE,
        appActivity: GOPAY_MAIN_ACTIVITY,
        appWaitPackage: GOPAY_APP_PACKAGE,
        appWaitActivity: '*',
        intentAction: 'android.intent.action.MAIN',
        intentCategory: 'android.intent.category.LAUNCHER',
      }),
    () => callOptionalAppCommand(driver, 'activateApp', GOPAY_APP_PACKAGE),
  ]

  for (const launch of launchAttempts) {
    if (remainingMs(deadline) <= 0) {
      break
    }

    const launched = await launch()
    if (!launched) {
      continue
    }

    await sleep(Math.min(GOPAY_NAVIGATION_SETTLE_MS, remainingMs(deadline)))
    if (await waitForGoPayNavigationAnchor(driver, deadline)) {
      return true
    }
  }

  if (await hasGoPayNavigationAnchor(driver)) {
    return false
  }

  if (await isGoPayForeground(driver)) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (await hasGoPayNavigationAnchor(driver)) {
        return false
      }

      await pressBack(driver)
      await sleep(Math.min(GOPAY_UNLINK_POLL_MS, remainingMs(deadline)))
    }
  }

  return false
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

async function pressBack(driver: GoPayAndroidUnlinkDriver): Promise<boolean> {
  if (typeof driver.back === 'function') {
    await Promise.resolve(driver.back.call(driver)).catch(() => undefined)
    return true
  }

  if (typeof driver.pressKeyCode === 'function') {
    await Promise.resolve(driver.pressKeyCode.call(driver, 4)).catch(
      () => undefined,
    )
    return true
  }

  return false
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

async function getDisplayedUnlinkButtons(
  driver: GoPayAndroidUnlinkDriver,
): Promise<GoPayAndroidDriverElement[]> {
  const buttons = await findDisplayedElements(driver, GOPAY_UNLINK_BUTTON_XPATH)
  const enabled: GoPayAndroidDriverElement[] = []
  for (const button of buttons) {
    if (await isElementEnabled(button).catch(() => false)) {
      enabled.push(button)
    }
  }

  return enabled
}

async function hasLinkedAppItem(
  driver: GoPayAndroidUnlinkDriver,
): Promise<boolean> {
  if (await hasDisplayedXPath(driver, GOPAY_LINKED_APP_ITEM_XPATH)) {
    return true
  }

  const source = await readPageSource(driver)
  return /content-desc="[^"]*Linked on/i.test(source)
}

async function waitForLinkedAppsContent(
  driver: GoPayAndroidUnlinkDriver,
  deadline: number,
): Promise<void> {
  const contentDeadline = Math.min(deadline, Date.now() + 3000)
  await waitUntil(
    async () =>
      (await isNoLinkedAppsState(driver)) ||
      (await getDisplayedUnlinkButtons(driver)).length > 0 ||
      (await hasLinkedAppItem(driver)),
    contentDeadline,
  )
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
  await clickAnyDisplayedXPathUntil(driver, [xpath], input)
}

async function openLinkedAppsPageIfNeeded(
  driver: GoPayAndroidUnlinkDriver,
  deadline: number,
  options: GoPayAndroidUnlinkOptions,
): Promise<GoPayLinkedAppsNavigationResult> {
  const navigation: GoPayLinkedAppsNavigationResult = {
    launchedGoPay: false,
    clickedProfile: false,
    clickedAccountSettings: false,
    clickedLinkedApps: false,
  }

  if (await isLinkedAppsPage(driver)) {
    return navigation
  }

  navigation.launchedGoPay = await launchGoPayMainActivityIfNeeded(
    driver,
    deadline,
  )
  if (navigation.launchedGoPay) {
    await reportProgress(options, {
      step: 'gopay-opened',
      message: 'Opened GoPay MainActivity',
    })
  }

  if (await isLinkedAppsPage(driver)) {
    return navigation
  }

  if (
    !(await hasAnyDisplayedXPath(driver, [
      GOPAY_ACCOUNT_APP_SETTINGS_XPATH,
      GOPAY_ACCOUNT_APP_SETTINGS_FUZZY_XPATH,
      GOPAY_LINKED_APPS_ENTRY_XPATH,
      GOPAY_LINKED_APPS_ENTRY_XML_ENTITY_XPATH,
      GOPAY_LINKED_APPS_FUZZY_ENTRY_XPATH,
    ]))
  ) {
    await clickAnyDisplayedXPathUntil(
      driver,
      [GOPAY_PROFILE_XPATH, GOPAY_PROFILE_FUZZY_XPATH],
      {
        deadline,
        description: 'Profile',
      },
    )
    navigation.clickedProfile = true
    await reportProgress(options, {
      step: 'profile-opened',
      message: 'Opened GoPay Profile',
    })

    const profileOpened = await waitUntil(
      async () =>
        (await isLinkedAppsPage(driver)) ||
        (await hasAnyDisplayedXPath(driver, [
          GOPAY_ACCOUNT_APP_SETTINGS_XPATH,
          GOPAY_ACCOUNT_APP_SETTINGS_FUZZY_XPATH,
          GOPAY_LINKED_APPS_ENTRY_XPATH,
          GOPAY_LINKED_APPS_ENTRY_XML_ENTITY_XPATH,
          GOPAY_LINKED_APPS_FUZZY_ENTRY_XPATH,
        ])),
      deadline,
    )
    if (!profileOpened) {
      throw new Error('GoPay Profile did not open account settings.')
    }
  }

  if (await isLinkedAppsPage(driver)) {
    return navigation
  }

  if (
    !(await hasAnyDisplayedXPath(driver, [
      GOPAY_LINKED_APPS_ENTRY_XPATH,
      GOPAY_LINKED_APPS_ENTRY_XML_ENTITY_XPATH,
      GOPAY_LINKED_APPS_FUZZY_ENTRY_XPATH,
    ]))
  ) {
    await clickAnyDisplayedXPathUntil(
      driver,
      [GOPAY_ACCOUNT_APP_SETTINGS_XPATH, GOPAY_ACCOUNT_APP_SETTINGS_FUZZY_XPATH],
      {
        deadline,
        description: 'Account & app settings',
      },
    )
    navigation.clickedAccountSettings = true
    await reportProgress(options, {
      step: 'account-settings-opened',
      message: 'Opened GoPay Account & app settings',
    })

    const accountSettingsOpened = await waitUntil(
      async () =>
        (await isLinkedAppsPage(driver)) ||
        (await hasAnyDisplayedXPath(driver, [
          GOPAY_LINKED_APPS_ENTRY_XPATH,
          GOPAY_LINKED_APPS_ENTRY_XML_ENTITY_XPATH,
          GOPAY_LINKED_APPS_FUZZY_ENTRY_XPATH,
        ])),
      deadline,
    )
    if (!accountSettingsOpened) {
      throw new Error('GoPay Account & app settings did not open.')
    }
  }

  if (await isLinkedAppsPage(driver)) {
    return navigation
  }

  await clickAnyDisplayedXPathUntil(
    driver,
    [
      GOPAY_LINKED_APPS_ENTRY_XPATH,
      GOPAY_LINKED_APPS_ENTRY_XML_ENTITY_XPATH,
      GOPAY_LINKED_APPS_FUZZY_ENTRY_XPATH,
    ],
    {
      deadline,
      description: 'Linked apps entry',
    },
  )
  navigation.clickedLinkedApps = true

  const opened = await waitUntil(() => isLinkedAppsPage(driver), deadline)
  if (!opened) {
    throw new Error('GoPay Linked apps page did not open.')
  }

  return navigation
}

async function exitLinkedAppsPage(
  driver: GoPayAndroidUnlinkDriver,
  deadline: number,
): Promise<boolean> {
  if (!(await isLinkedAppsPage(driver))) {
    return false
  }

  await clickAnyDisplayedXPath(driver, [
    GOPAY_LINKED_APPS_BACK_BUTTON_XPATH,
    GOPAY_LINKED_APPS_BACK_BUTTON_FUZZY_XPATH,
    GOPAY_BACK_IMAGE_XPATH,
  ])
  if (await waitUntil(async () => !(await isLinkedAppsPage(driver)), deadline)) {
    return true
  }

  await pressBack(driver)
  return waitUntil(async () => !(await isLinkedAppsPage(driver)), deadline)
}

async function unlinkVisibleLinkedApps(
  driver: GoPayAndroidUnlinkDriver,
  deadline: number,
  options: GoPayAndroidUnlinkOptions,
): Promise<number> {
  let unlinkedAppCount = 0

  do {
    await waitForLinkedAppsContent(driver, deadline)

    if (await isNoLinkedAppsState(driver)) {
      return unlinkedAppCount
    }

    const unlinkButtons = await getDisplayedUnlinkButtons(driver)
    if (unlinkButtons.length === 0) {
      if (!(await hasLinkedAppItem(driver))) {
        return unlinkedAppCount
      }

      throw new Error(
        'GoPay linked app is visible, but its Unlink button was not visible.',
      )
    }

    const initialUnlink = unlinkButtons.at(0)
    if (!initialUnlink?.click) {
      throw new Error('GoPay initial Unlink button was not clickable.')
    }
    await initialUnlink.click()
    await reportProgress(options, {
      step: 'unlink-clicked',
      message: 'Clicked GoPay linked app Unlink button',
    })

    const beforeConfirmDelay = Math.min(
      GOPAY_CONFIRM_SETTLE_MS,
      Math.max(0, remainingMs(deadline) - GOPAY_UNLINK_POLL_MS),
    )
    if (beforeConfirmDelay > 0) {
      await sleep(beforeConfirmDelay)
    }
    await clickDisplayedXPath(driver, GOPAY_UNLINK_BUTTON_XPATH, {
      deadline,
      description: 'confirmation Unlink button',
      pick: 'last',
    })
    unlinkedAppCount += 1
    await reportProgress(options, {
      step: 'unlink-confirmed',
      message: 'Confirmed GoPay linked app unlink',
    })
    return unlinkedAppCount
  } while (remainingMs(deadline) > 0)

  throw new Error('GoPay linked app confirmation Unlink was not clicked.')
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
  const navigation = await openLinkedAppsPageIfNeeded(driver, deadline, options)

  await reportProgress(options, {
    step: 'linked-apps-opened',
    message: navigation.clickedLinkedApps
      ? 'Opened GoPay Linked apps page'
      : 'GoPay Linked apps page is already open',
  })

  await waitForLinkedAppsContent(driver, deadline)
  const hasNoLinkedApps = await isNoLinkedAppsState(driver)
  const initialUnlinkButtons = hasNoLinkedApps
    ? []
    : await getDisplayedUnlinkButtons(driver)
  const hasInitialLinkedApp = hasNoLinkedApps
    ? false
    : await hasLinkedAppItem(driver)

  if (
    hasNoLinkedApps ||
    (initialUnlinkButtons.length === 0 && !hasInitialLinkedApp)
  ) {
    const exitedLinkedApps = await exitLinkedAppsPage(driver, deadline)
    if (exitedLinkedApps) {
      await reportProgress(options, {
        step: 'linked-apps-exited',
        message: 'Exited GoPay Linked apps page',
      })
    }
    await reportProgress(options, {
      step: 'already-unlinked',
      message: 'GoPay has no linked apps',
    })
    return {
      status: 'already-unlinked',
      appiumSessionId: session.appiumSessionId,
      currentPackage,
      currentActivity,
      launchedGoPay: navigation.launchedGoPay,
      clickedProfile: navigation.clickedProfile,
      clickedAccountSettings: navigation.clickedAccountSettings,
      clickedLinkedApps: navigation.clickedLinkedApps,
      clickedInitialUnlink: false,
      clickedConfirmUnlink: false,
      unlinkedAppCount: 0,
      exitedLinkedApps,
    }
  }

  const unlinkedAppCount = await unlinkVisibleLinkedApps(
    driver,
    deadline,
    options,
  )
  const exitedLinkedApps = false

  await reportProgress(options, {
    step: 'completed',
    message: 'GoPay linked app unlink completed',
  })

  return {
    status: 'unlinked',
    appiumSessionId: session.appiumSessionId,
    currentPackage,
    currentActivity,
    launchedGoPay: navigation.launchedGoPay,
    clickedProfile: navigation.clickedProfile,
    clickedAccountSettings: navigation.clickedAccountSettings,
    clickedLinkedApps: navigation.clickedLinkedApps,
    clickedInitialUnlink: true,
    clickedConfirmUnlink: true,
    unlinkedAppCount,
    exitedLinkedApps,
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
