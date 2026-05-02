import { describe, expect, it } from 'vitest'
import {
  GOPAY_ACCOUNT_APP_SETTINGS_FUZZY_XPATH,
  GOPAY_ACCOUNT_APP_SETTINGS_XPATH,
  GOPAY_APP_PACKAGE,
  GOPAY_BACK_IMAGE_XPATH,
  GOPAY_LINKED_APPS_ENTRY_XPATH,
  GOPAY_LINKED_APPS_ENTRY_XML_ENTITY_XPATH,
  GOPAY_LINKED_APPS_BACK_BUTTON_FUZZY_XPATH,
  GOPAY_LINKED_APPS_BACK_BUTTON_XPATH,
  GOPAY_LINKED_APPS_FUZZY_ENTRY_XPATH,
  GOPAY_LINKED_APPS_TITLE_XPATH,
  GOPAY_LINKED_APP_ITEM_XPATH,
  GOPAY_MAIN_ACTIVITY,
  GOPAY_NO_LINKED_APPS_XPATH,
  GOPAY_PROFILE_FUZZY_XPATH,
  GOPAY_PROFILE_XPATH,
  GOPAY_UNLINK_BUTTON_XPATH,
  unlinkGoPayLinkedAppsInSession,
  type GoPayAndroidUnlinkDriver,
} from '../src/modules/gopay/android-unlink'

type FakeGoPayScreen =
  | 'other-app'
  | 'home'
  | 'profile'
  | 'settings'
  | 'linked-apps'
  | 'confirm'
  | 'empty'
  | 'notification'
  | 'linked-app-without-unlink'
  | 'loading'

class FakeAndroidElement {
  constructor(
    private readonly driver: FakeGoPayAndroidDriver,
    private readonly name: string,
    private readonly onClick?: () => void,
  ) {}

  async isDisplayed(): Promise<boolean> {
    return true
  }

  async isEnabled(): Promise<boolean> {
    return true
  }

  async click(): Promise<void> {
    this.driver.clicks.push(this.name)
    this.onClick?.()
  }
}

class FakeGoPayAndroidDriver implements GoPayAndroidUnlinkDriver {
  clicks: string[] = []
  startActivityCalls: Array<{ appPackage: string; appActivity: string }> = []

  constructor(
    private screen: FakeGoPayScreen,
    private linkedAppCount = screen === 'linked-apps' ? 1 : 0,
  ) {}

  async $$(selector: string): Promise<FakeAndroidElement[]> {
    if (
      this.screen === 'home' &&
      (selector === GOPAY_PROFILE_XPATH || selector === GOPAY_PROFILE_FUZZY_XPATH)
    ) {
      return [
        new FakeAndroidElement(this, 'profile', () => {
          this.screen = 'profile'
        }),
      ]
    }

    if (
      this.screen === 'profile' &&
      (selector === GOPAY_ACCOUNT_APP_SETTINGS_XPATH ||
        selector === GOPAY_ACCOUNT_APP_SETTINGS_FUZZY_XPATH)
    ) {
      return [
        new FakeAndroidElement(this, 'account-settings', () => {
          this.screen = 'settings'
        }),
      ]
    }

    if (
      this.screen === 'settings' &&
      (selector === GOPAY_LINKED_APPS_ENTRY_XPATH ||
        selector === GOPAY_LINKED_APPS_ENTRY_XML_ENTITY_XPATH ||
        selector === GOPAY_LINKED_APPS_FUZZY_ENTRY_XPATH)
    ) {
      return [
        new FakeAndroidElement(this, 'linked-apps-entry', () => {
          this.screen = 'linked-apps'
          if (this.linkedAppCount === 0) {
            this.linkedAppCount = 1
          }
        }),
      ]
    }

    if (
      (this.screen === 'linked-apps' ||
        this.screen === 'empty' ||
        this.screen === 'linked-app-without-unlink' ||
        this.screen === 'loading') &&
      selector === GOPAY_LINKED_APPS_TITLE_XPATH
    ) {
      return [new FakeAndroidElement(this, 'linked-apps-title')]
    }

    if (
      this.screen === 'linked-apps' &&
      this.linkedAppCount > 0 &&
      selector === GOPAY_LINKED_APP_ITEM_XPATH
    ) {
      return [new FakeAndroidElement(this, 'linked-app-item')]
    }

    if (
      this.screen === 'linked-app-without-unlink' &&
      selector === GOPAY_LINKED_APP_ITEM_XPATH
    ) {
      return [new FakeAndroidElement(this, 'linked-app-item')]
    }

    if (this.screen === 'empty' && selector === GOPAY_NO_LINKED_APPS_XPATH) {
      return [new FakeAndroidElement(this, 'no-linked-apps')]
    }

    if (selector === GOPAY_UNLINK_BUTTON_XPATH) {
      if (this.screen === 'linked-apps' && this.linkedAppCount > 0) {
        return [
          new FakeAndroidElement(this, 'initial-unlink', () => {
            this.screen = 'confirm'
          }),
        ]
      }
      if (this.screen === 'confirm') {
        return [
          new FakeAndroidElement(this, 'background-unlink'),
          new FakeAndroidElement(this, 'confirm-unlink', () => {
            this.linkedAppCount -= 1
            this.screen = this.linkedAppCount > 0 ? 'linked-apps' : 'empty'
          }),
        ]
      }
    }

    if (
      (this.screen === 'linked-apps' || this.screen === 'empty') &&
      (selector === GOPAY_LINKED_APPS_BACK_BUTTON_XPATH ||
        selector === GOPAY_LINKED_APPS_BACK_BUTTON_FUZZY_XPATH ||
        selector === GOPAY_BACK_IMAGE_XPATH)
    ) {
      return [
        new FakeAndroidElement(this, 'linked-apps-back', () => {
          this.screen = 'settings'
        }),
      ]
    }

    return []
  }

  async getPageSource(): Promise<string> {
    if (this.screen === 'notification') {
      return '<android.widget.FrameLayout package="com.android.systemui" pane-title="Notification shade." />'
    }
    if (this.screen === 'other-app') {
      return '<android.widget.FrameLayout package="example.other" />'
    }
    if (
      this.screen === 'linked-apps' ||
      this.screen === 'empty' ||
      this.screen === 'linked-app-without-unlink'
    ) {
      return '<android.widget.FrameLayout pane-title="Linked apps" />'
    }
    if (this.screen === 'loading') {
      return [
        '<android.widget.FrameLayout package="com.gojek.gopay" pane-title="Linked apps">',
        '<android.widget.Button><android.widget.ImageView content-desc="Back" /></android.widget.Button>',
        '<android.view.View content-desc="Linked apps" heading="true" />',
        '<android.view.View bounds="[48,375][1296,762]" />',
        '<android.view.View bounds="[48,762][1296,1149]" />',
        '<android.view.View bounds="[48,1149][1296,1533]" />',
        '</android.widget.FrameLayout>',
      ].join('')
    }
    if (this.screen === 'home') {
      return '<android.widget.ImageView package="com.gojek.gopay" content-desc="Profile" />'
    }
    if (this.screen === 'profile') {
      return '<android.view.View package="com.gojek.gopay" content-desc="Account & app settings Control your app preferences, data, linked apps and more." />'
    }
    return '<android.widget.FrameLayout package="com.gojek.gopay" pane-title="Account &amp; app settings"><android.view.View content-desc="Linked apps&#10;List of apps that you link to GoPay" /></android.widget.FrameLayout>'
  }

  async back(): Promise<void> {
    this.clicks.push('back')
    if (this.screen === 'notification') {
      this.screen = 'empty'
    } else if (this.screen === 'linked-apps' || this.screen === 'empty') {
      this.screen = 'settings'
    } else if (this.screen === 'settings') {
      this.screen = 'profile'
    } else if (this.screen === 'profile') {
      this.screen = 'home'
    }
  }

  async getCurrentPackage(): Promise<string> {
    return this.screen === 'other-app' ? 'example.other' : GOPAY_APP_PACKAGE
  }

  async getCurrentActivity(): Promise<string> {
    return this.screen === 'other-app' ? '.OtherActivity' : GOPAY_MAIN_ACTIVITY
  }

  async startActivity(
    appPackage: string,
    appActivity: string,
  ): Promise<void> {
    this.startActivityCalls.push({ appPackage, appActivity })
    if (appPackage === GOPAY_APP_PACKAGE && appActivity === GOPAY_MAIN_ACTIVITY) {
      this.screen = 'home'
    }
  }
}

describe('GoPay Android unlink helper', () => {
  it('treats the empty Linked apps page as confirmed', async () => {
    const driver = new FakeGoPayAndroidDriver('empty')

    const result = await unlinkGoPayLinkedAppsInSession(
      {
        appiumSessionId: 'appium-1',
        driver: driver as never,
      },
      { timeoutMs: 50 },
    )

    expect(result).toMatchObject({
      status: 'already-unlinked',
      appiumSessionId: 'appium-1',
      currentPackage: 'com.gojek.gopay',
      currentActivity: '.MainActivity',
      clickedLinkedApps: false,
      clickedInitialUnlink: false,
      clickedConfirmUnlink: false,
      unlinkedAppCount: 0,
      exitedLinkedApps: true,
    })
    expect(driver.clicks).toEqual(['linked-apps-back'])
  })

  it('opens Linked apps and clicks both distinct Unlink buttons', async () => {
    const driver = new FakeGoPayAndroidDriver('settings')

    const result = await unlinkGoPayLinkedAppsInSession(
      {
        appiumSessionId: 'appium-2',
        driver: driver as never,
      },
      { timeoutMs: 1000 },
    )

    expect(result).toMatchObject({
      status: 'unlinked',
      clickedLinkedApps: true,
      clickedInitialUnlink: true,
      clickedConfirmUnlink: true,
      unlinkedAppCount: 1,
      exitedLinkedApps: false,
    })
    expect(driver.clicks).toEqual([
      'linked-apps-entry',
      'initial-unlink',
      'confirm-unlink',
    ])
  })

  it('does not mistake the Account & app settings Linked apps row for the page', async () => {
    const driver = new FakeGoPayAndroidDriver('settings')

    const result = await unlinkGoPayLinkedAppsInSession(
      {
        appiumSessionId: 'appium-settings-menu',
        driver: driver as never,
      },
      { timeoutMs: 1000 },
    )

    expect(result).toMatchObject({
      status: 'unlinked',
      clickedLinkedApps: true,
      unlinkedAppCount: 1,
      exitedLinkedApps: false,
    })
    expect(driver.clicks).toContain('linked-apps-entry')
  })

  it('launches GoPay MainActivity and navigates through Profile settings', async () => {
    const driver = new FakeGoPayAndroidDriver('other-app')

    const result = await unlinkGoPayLinkedAppsInSession(
      {
        appiumSessionId: 'appium-4',
        driver: driver as never,
      },
      { timeoutMs: 5000 },
    )

    expect(result).toMatchObject({
      status: 'unlinked',
      launchedGoPay: true,
      clickedProfile: true,
      clickedAccountSettings: true,
      clickedLinkedApps: true,
      unlinkedAppCount: 1,
      exitedLinkedApps: false,
    })
    expect(driver.startActivityCalls).toEqual([
      {
        appPackage: GOPAY_APP_PACKAGE,
        appActivity: GOPAY_MAIN_ACTIVITY,
      },
    ])
    expect(driver.clicks).toEqual([
      'profile',
      'account-settings',
      'linked-apps-entry',
      'initial-unlink',
      'confirm-unlink',
    ])
  })

  it('treats the confirmation Unlink click as task completion', async () => {
    const driver = new FakeGoPayAndroidDriver('linked-apps', 2)

    const result = await unlinkGoPayLinkedAppsInSession(
      {
        appiumSessionId: 'appium-5',
        driver: driver as never,
      },
      { timeoutMs: 5000 },
    )

    expect(result).toMatchObject({
      status: 'unlinked',
      clickedLinkedApps: false,
      clickedInitialUnlink: true,
      clickedConfirmUnlink: true,
      unlinkedAppCount: 1,
      exitedLinkedApps: false,
    })
    expect(driver.clicks).toEqual([
      'initial-unlink',
      'confirm-unlink',
    ])
  })

  it('fails when Linked apps shows only loading placeholders', async () => {
    const driver = new FakeGoPayAndroidDriver('loading')

    await expect(
      unlinkGoPayLinkedAppsInSession(
        {
          appiumSessionId: 'appium-loading',
          driver: driver as never,
        },
        { timeoutMs: 50 },
      ),
    ).rejects.toThrow(
      'GoPay Linked apps content did not finish loading before timeout.',
    )
    expect(driver.clicks).toEqual([])
  })

  it('fails when Linked apps has no confirmed empty state, app rows, or unlink buttons', async () => {
    const driver = new FakeGoPayAndroidDriver('linked-apps', 0)

    await expect(
      unlinkGoPayLinkedAppsInSession(
        {
          appiumSessionId: 'appium-6',
          driver: driver as never,
        },
        { timeoutMs: 50 },
      ),
    ).rejects.toThrow(
      'GoPay Linked apps content did not finish loading before timeout.',
    )
    expect(driver.clicks).toEqual([])
  })

  it('fails when a linked app row exists but no Unlink button appears', async () => {
    const driver = new FakeGoPayAndroidDriver('linked-app-without-unlink')

    await expect(
      unlinkGoPayLinkedAppsInSession(
        {
          appiumSessionId: 'appium-7',
          driver: driver as never,
        },
        { timeoutMs: 1000 },
      ),
    ).rejects.toThrow(
      'GoPay linked app is visible, but its Unlink button was not visible.',
    )
  })

  it('dismisses Android system overlays before checking linked apps', async () => {
    const driver = new FakeGoPayAndroidDriver('notification')

    const result = await unlinkGoPayLinkedAppsInSession(
      {
        appiumSessionId: 'appium-3',
        driver: driver as never,
      },
      { timeoutMs: 1000 },
    )

    expect(result).toMatchObject({
      status: 'already-unlinked',
      clickedLinkedApps: false,
      exitedLinkedApps: true,
    })
    expect(driver.clicks).toEqual(['back', 'linked-apps-back'])
  })
})
