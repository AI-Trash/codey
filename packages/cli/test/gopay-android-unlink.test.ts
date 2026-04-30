import { describe, expect, it } from 'vitest'
import {
  GOPAY_LINKED_APPS_ENTRY_XPATH,
  GOPAY_LINKED_APPS_FUZZY_ENTRY_XPATH,
  GOPAY_LINKED_APPS_TITLE_XPATH,
  GOPAY_NO_LINKED_APPS_XPATH,
  GOPAY_UNLINK_BUTTON_XPATH,
  unlinkGoPayLinkedAppsInSession,
  type GoPayAndroidUnlinkDriver,
} from '../src/modules/gopay/android-unlink'

type FakeGoPayScreen =
  | 'settings'
  | 'linked-apps'
  | 'confirm'
  | 'empty'
  | 'notification'

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

  constructor(private screen: FakeGoPayScreen) {}

  async $$(selector: string): Promise<FakeAndroidElement[]> {
    if (
      this.screen === 'settings' &&
      (selector === GOPAY_LINKED_APPS_ENTRY_XPATH ||
        selector === GOPAY_LINKED_APPS_FUZZY_ENTRY_XPATH)
    ) {
      return [
        new FakeAndroidElement(this, 'linked-apps-entry', () => {
          this.screen = 'linked-apps'
        }),
      ]
    }

    if (
      (this.screen === 'linked-apps' || this.screen === 'empty') &&
      selector === GOPAY_LINKED_APPS_TITLE_XPATH
    ) {
      return [new FakeAndroidElement(this, 'linked-apps-title')]
    }

    if (this.screen === 'empty' && selector === GOPAY_NO_LINKED_APPS_XPATH) {
      return [new FakeAndroidElement(this, 'no-linked-apps')]
    }

    if (selector === GOPAY_UNLINK_BUTTON_XPATH) {
      if (this.screen === 'linked-apps') {
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
            this.screen = 'empty'
          }),
        ]
      }
    }

    return []
  }

  async getPageSource(): Promise<string> {
    if (this.screen === 'notification') {
      return '<android.widget.FrameLayout package="com.android.systemui" pane-title="Notification shade." />'
    }
    if (this.screen === 'linked-apps' || this.screen === 'empty') {
      return '<android.widget.FrameLayout pane-title="Linked apps" />'
    }
    return '<android.view.View content-desc="Linked apps List of apps that you link to GoPay" />'
  }

  async back(): Promise<void> {
    this.clicks.push('back')
    if (this.screen === 'notification') {
      this.screen = 'empty'
    }
  }

  async getCurrentPackage(): Promise<string> {
    return 'com.gojek.gopay'
  }

  async getCurrentActivity(): Promise<string> {
    return '.MainActivity'
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
    })
    expect(driver.clicks).toEqual([])
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
    })
    expect(driver.clicks).toEqual([
      'linked-apps-entry',
      'initial-unlink',
      'confirm-unlink',
    ])
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
    })
    expect(driver.clicks).toEqual(['back'])
  })
})
