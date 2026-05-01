import crypto from 'crypto'
import type { SelectorTarget } from '../../types'
import { logCliEvent } from '../../utils/observability'

export const CHATGPT_HOME_URL = 'https://chatgpt.com/'
export const CHATGPT_TEAM_TRIAL_PROMO_COUPON = 'team-1-month-free'
export const CHATGPT_PLUS_TRIAL_PROMO_COUPON = 'plus-1-month-free'
export const CHATGPT_TRIAL_PROMO_COUPONS = [
  CHATGPT_TEAM_TRIAL_PROMO_COUPON,
  CHATGPT_PLUS_TRIAL_PROMO_COUPON,
] as const
export type ChatGPTTrialPromoCoupon =
  (typeof CHATGPT_TRIAL_PROMO_COUPONS)[number]
export type ChatGPTTrialPromoPlan = 'team' | 'plus'
export const CHATGPT_TRIAL_PAYMENT_METHODS = ['paypal', 'gopay'] as const
export type ChatGPTTrialPaymentMethod =
  (typeof CHATGPT_TRIAL_PAYMENT_METHODS)[number]
export const DEFAULT_CHATGPT_TRIAL_PAYMENT_METHOD: ChatGPTTrialPaymentMethod =
  'paypal'
export const CHATGPT_GOPAY_PRICING_REGION = 'ID'

export function normalizeChatGPTTrialPaymentMethod(
  value: unknown,
): ChatGPTTrialPaymentMethod | undefined {
  if (typeof value === 'boolean') {
    return value ? DEFAULT_CHATGPT_TRIAL_PAYMENT_METHOD : undefined
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  if (!normalized || ['0', 'false', 'no', 'off', 'none'].includes(normalized)) {
    return undefined
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return DEFAULT_CHATGPT_TRIAL_PAYMENT_METHOD
  }

  return CHATGPT_TRIAL_PAYMENT_METHODS.find((method) => method === normalized)
}

export const CHATGPT_TRIAL_PROMO_PLAN_BY_COUPON = {
  [CHATGPT_TEAM_TRIAL_PROMO_COUPON]: 'team',
  [CHATGPT_PLUS_TRIAL_PROMO_COUPON]: 'plus',
} as const satisfies Record<ChatGPTTrialPromoCoupon, ChatGPTTrialPromoPlan>
export function getChatGPTTrialPromoPlan(
  coupon: ChatGPTTrialPromoCoupon,
): ChatGPTTrialPromoPlan {
  return CHATGPT_TRIAL_PROMO_PLAN_BY_COUPON[coupon]
}
export function buildChatGPTTrialPricingPromoUrl(
  coupon: ChatGPTTrialPromoCoupon,
): string {
  return `https://chatgpt.com/?promo_campaign=${coupon}#pricing`
}
export const CHATGPT_TEAM_PRICING_PROMO_URL = buildChatGPTTrialPricingPromoUrl(
  CHATGPT_TEAM_TRIAL_PROMO_COUPON,
)
export const CHATGPT_PLUS_PRICING_PROMO_URL = buildChatGPTTrialPricingPromoUrl(
  CHATGPT_PLUS_TRIAL_PROMO_COUPON,
)
export const CHATGPT_ENTRY_LOGIN_URL = 'https://chatgpt.com/auth/login'
export const CHATGPT_LOGIN_URL =
  'https://auth.openai.com/log-in-or-create-account'
export const CHATGPT_LOGIN_V2_URL = 'https://auth.openai.com/log-in'
export const CHATGPT_OAUTH_LOGIN_URL =
  'https://auth.openai.com/api/accounts/login'
export const CHATGPT_OAUTH_AUTHORIZE_URL =
  'https://auth.openai.com/oauth/authorize'
export const CHATGPT_CODEX_CONSENT_URL =
  'https://auth.openai.com/sign-in-with-chatgpt/codex/consent'
export const CHATGPT_CODEX_ORGANIZATION_URL =
  'https://auth.openai.com/sign-in-with-chatgpt/codex/organization'
export const CHATGPT_CODEX_ACCOUNT_CONSENT_URL =
  'https://auth.openai.com/api/accounts/consent'
export const CHATGPT_CHECKOUT_ORIGIN = 'https://chatgpt.com'
export const CHATGPT_TRIAL_CHECKOUT_PATH = '/backend-api/payments/checkout'
export const CHATGPT_TRIAL_CHECKOUT_URL = `${CHATGPT_CHECKOUT_ORIGIN}${CHATGPT_TRIAL_CHECKOUT_PATH}`
export const DEFAULT_CHATGPT_TRIAL_CHECKOUT_PROCESSOR_ENTITY = 'openai_ie'
export const CHATGPT_TEAM_TRIAL_CHECKOUT_PLAN_NAME = 'chatgptteamplan'
export const CHATGPT_PLUS_TRIAL_CHECKOUT_PLAN_NAME = 'chatgptplusplan'
export const CHATGPT_TEAM_TRIAL_CHECKOUT_WORKSPACE_NAME = 'Sam Altman'
export const CHATGPT_TEAM_TRIAL_CHECKOUT_SEAT_QUANTITY = 5
export const CHATGPT_TRIAL_CHECKOUT_BILLING_DETAILS = {
  paypal: {
    country: 'FR',
    currency: 'EUR',
  },
  gopay: {
    country: 'ID',
    currency: 'IDR',
  },
} as const satisfies Record<
  ChatGPTTrialPaymentMethod,
  {
    country: string
    currency: string
  }
>
export const ADULT_AGE = '25'
export const ADULT_BIRTHDAY = '1999-01-01'
export const ADULT_BIRTH_YEAR = '1999'
export const ADULT_BIRTH_MONTH = '01'
export const ADULT_BIRTH_DAY = '01'
export const PROFILE_NAME = 'Alex Carter'
export const MIN_ONBOARDING_CLICKS = 4
export const ONBOARDING_IDLE_POLL_MS = 500
export const ONBOARDING_IDLE_WAIT_BEFORE_MIN_CLICKS_MS = 10000
export const ONBOARDING_IDLE_WAIT_AFTER_MIN_CLICKS_MS = 3000
export const DEFAULT_EVENT_TIMEOUT_MS = 5000

export const PLUS_PRICING_FREE_TRIAL_SELECTORS: SelectorTarget[] = [
  'button[data-testid="select-plan-button-plus-upgrade"]',
  'button[data-testid="select-plan-button-plus"]',
  'button[data-testid="select-plan-button-plus-create"]',
  'button[data-testid*="plus" i]',
  '[data-testid*="plus" i] button',
  'a[href*="promo_campaign=plus-1-month-free"]',
  {
    role: 'button',
    options: {
      name: /plus.*(?:领取免费试用|免费试用|free trial|try for free|start trial)|(?:领取免费试用|免费试用|free trial|try for free|start trial).*plus/i,
    },
  },
]

export const TEAM_PRICING_FREE_TRIAL_SELECTORS: SelectorTarget[] = [
  'button[data-testid="select-plan-button-teams-create"]',
  'button[data-testid="select-plan-button-team-create"]',
  'button[data-testid*="team" i]',
  '[data-testid*="team" i] button',
  'a[href*="promo_campaign=team-1-month-free"]',
  {
    role: 'button',
    options: {
      name: /team.*(?:领取免费试用|免费试用|free trial|try for free|start trial)|(?:领取免费试用|免费试用|free trial|try for free|start trial).*team/i,
    },
  },
]

export const PLUS_PRICING_PLAN_TOGGLE_SELECTORS: SelectorTarget[] = [
  'button[role="radio"][aria-label*="个人"]',
  'button[role="radio"][aria-label*="Personal" i]',
  'button[role="radio"]:has-text("个人")',
  'button[role="radio"]:has-text("Personal")',
  {
    role: 'radio',
    options: { name: /个人|personal/i },
  },
  {
    role: 'button',
    options: { name: /^个人$|^personal$/i },
  },
]

export const TEAM_PRICING_PLAN_TOGGLE_SELECTORS: SelectorTarget[] = [
  'button[role="radio"][aria-label*="Business" i]',
  'button[role="radio"][aria-label*="企业"]',
  'button[role="radio"]:has-text("Business")',
  'button[role="radio"]:has-text("企业")',
  {
    role: 'radio',
    options: { name: /business|team|企业/i },
  },
  {
    role: 'button',
    options: { name: /^business$|^team$|^企业$/i },
  },
]

export function getChatGPTTrialPricingFreeTrialSelectors(
  coupon: ChatGPTTrialPromoCoupon,
): SelectorTarget[] {
  return coupon === CHATGPT_PLUS_TRIAL_PROMO_COUPON
    ? PLUS_PRICING_FREE_TRIAL_SELECTORS
    : TEAM_PRICING_FREE_TRIAL_SELECTORS
}

export function getChatGPTTrialPricingPlanToggleSelectors(
  coupon: ChatGPTTrialPromoCoupon,
): SelectorTarget[] {
  return coupon === CHATGPT_PLUS_TRIAL_PROMO_COUPON
    ? PLUS_PRICING_PLAN_TOGGLE_SELECTORS
    : TEAM_PRICING_PLAN_TOGGLE_SELECTORS
}

export const CHATGPT_CHECKOUT_BILLING_ADDRESS_FRAME_SELECTORS: SelectorTarget[] =
  [
    'iframe[src*="elements-inner-address"]',
    'iframe[title*="地址"]',
    'iframe[title*="address" i]',
  ]

export const CHATGPT_CHECKOUT_PAYMENT_METHOD_FRAME_SELECTORS: SelectorTarget[] =
  [
    'iframe[src*="elements-inner-payment"]',
    'iframe[title*="付款"]',
    'iframe[title*="支付"]',
    'iframe[title*="payment" i]',
  ]

export const CHATGPT_CHECKOUT_PAYPAL_PAYMENT_METHOD_SELECTORS = [
  '[role="tab"][value*="paypal" i]',
  '[role="tab"][data-testid*="paypal" i]',
  '[role="tab"][aria-controls*="paypal" i]',
  '[role="tab"][id*="paypal" i]',
  '[role="tab"][aria-label*="paypal" i]',
  '[role="radio"][value*="paypal" i]',
  '[role="radio"][data-testid*="paypal" i]',
  '[role="radio"][id*="paypal" i]',
  '[role="radio"][aria-label*="paypal" i]',
  'button[value*="paypal" i]',
  'button[data-testid*="paypal" i]',
  'button[id*="paypal" i]',
  'button[aria-controls*="paypal" i]',
  'button[aria-label*="paypal" i]',
  'button#paypal-tab',
  'input[value*="paypal" i]',
  'input[id*="paypal" i]',
  'label[for*="paypal" i]',
] as const

export const CHATGPT_CHECKOUT_GOPAY_PAYMENT_METHOD_SELECTORS = [
  '[role="tab"][value*="gopay" i]',
  '[role="tab"][value*="go-pay" i]',
  '[role="tab"][value*="go_pay" i]',
  '[role="tab"][data-testid*="gopay" i]',
  '[role="tab"][data-testid*="go-pay" i]',
  '[role="tab"][data-testid*="go_pay" i]',
  '[role="tab"][aria-controls*="gopay" i]',
  '[role="tab"][aria-controls*="go-pay" i]',
  '[role="tab"][aria-controls*="go_pay" i]',
  '[role="tab"][id*="gopay" i]',
  '[role="tab"][id*="go-pay" i]',
  '[role="tab"][id*="go_pay" i]',
  '[role="tab"][aria-label*="gopay" i]',
  '[role="tab"][aria-label*="go pay" i]',
  '[role="radio"][value*="gopay" i]',
  '[role="radio"][value*="go-pay" i]',
  '[role="radio"][value*="go_pay" i]',
  '[role="radio"][data-testid*="gopay" i]',
  '[role="radio"][data-testid*="go-pay" i]',
  '[role="radio"][data-testid*="go_pay" i]',
  '[role="radio"][id*="gopay" i]',
  '[role="radio"][id*="go-pay" i]',
  '[role="radio"][id*="go_pay" i]',
  '[role="radio"][aria-label*="gopay" i]',
  '[role="radio"][aria-label*="go pay" i]',
  'button[value*="gopay" i]',
  'button[value*="go-pay" i]',
  'button[value*="go_pay" i]',
  'button[data-testid*="gopay" i]',
  'button[data-testid*="go-pay" i]',
  'button[data-testid*="go_pay" i]',
  'button[id*="gopay" i]',
  'button[id*="go-pay" i]',
  'button[id*="go_pay" i]',
  'button[aria-controls*="gopay" i]',
  'button[aria-controls*="go-pay" i]',
  'button[aria-controls*="go_pay" i]',
  'button[aria-label*="gopay" i]',
  'button[aria-label*="go pay" i]',
  'button#gopay-tab',
  'input[value*="gopay" i]',
  'input[value*="go-pay" i]',
  'input[value*="go_pay" i]',
  'input[id*="gopay" i]',
  'input[id*="go-pay" i]',
  'input[id*="go_pay" i]',
  'label[for*="gopay" i]',
  'label[for*="go-pay" i]',
  'label[for*="go_pay" i]',
] as const

export const CHATGPT_CHECKOUT_PAYMENT_METHOD_SELECTORS = {
  paypal: CHATGPT_CHECKOUT_PAYPAL_PAYMENT_METHOD_SELECTORS,
  gopay: CHATGPT_CHECKOUT_GOPAY_PAYMENT_METHOD_SELECTORS,
} as const satisfies Record<ChatGPTTrialPaymentMethod, readonly string[]>

export const CHATGPT_CHECKOUT_PAYPAL_SELECTORS: SelectorTarget[] = [
  { role: 'radio', options: { name: /paypal/i } },
  { role: 'tab', options: { name: /paypal/i } },
  { role: 'button', options: { name: /paypal/i } },
  ...CHATGPT_CHECKOUT_PAYPAL_PAYMENT_METHOD_SELECTORS,
  { text: /paypal/i },
]

export const CHATGPT_CHECKOUT_GOPAY_SELECTORS: SelectorTarget[] = [
  { role: 'radio', options: { name: /go\s*pay|gopay/i } },
  { role: 'tab', options: { name: /go\s*pay|gopay/i } },
  { role: 'button', options: { name: /go\s*pay|gopay/i } },
  ...CHATGPT_CHECKOUT_GOPAY_PAYMENT_METHOD_SELECTORS,
  { text: /go\s*pay|gopay/i },
]

export const CHATGPT_CHECKOUT_SUBSCRIBE_SELECTORS: SelectorTarget[] = [
  'button[data-testid="checkout-submit-button"]',
  'button[type="submit"]',
  {
    role: 'button',
    options: {
      name: /订阅|購読|subscribe|start trial|start free trial|confirm/i,
    },
  },
  {
    text: /订阅|購読|subscribe|start trial|start free trial|confirm/i,
  },
]

export interface ChatGPTTrialCheckoutPayload {
  entry_point: 'all_plans_pricing_modal'
  plan_name:
    | typeof CHATGPT_TEAM_TRIAL_CHECKOUT_PLAN_NAME
    | typeof CHATGPT_PLUS_TRIAL_CHECKOUT_PLAN_NAME
  billing_details: {
    country: string
    currency: string
  }
  promo_campaign: {
    promo_campaign_id: ChatGPTTrialPromoCoupon
    is_coupon_from_query_param: false
  }
  checkout_ui_mode: 'custom'
}

export function buildChatGPTTrialCheckoutPayload(
  coupon: ChatGPTTrialPromoCoupon,
  options: {
    paymentMethod?: ChatGPTTrialPaymentMethod
  } = {},
): ChatGPTTrialCheckoutPayload {
  const billingDetails =
    CHATGPT_TRIAL_CHECKOUT_BILLING_DETAILS[
      options.paymentMethod || DEFAULT_CHATGPT_TRIAL_PAYMENT_METHOD
    ]
  const basePayload = {
    entry_point: 'all_plans_pricing_modal',
    billing_details: { ...billingDetails },
    promo_campaign: {
      promo_campaign_id: coupon,
      is_coupon_from_query_param: false,
    },
    checkout_ui_mode: 'custom',
  } as const

  if (coupon === CHATGPT_PLUS_TRIAL_PROMO_COUPON) {
    return {
      plan_name: CHATGPT_PLUS_TRIAL_CHECKOUT_PLAN_NAME,
      ...basePayload,
    }
  }

  return {
    plan_name: CHATGPT_TEAM_TRIAL_CHECKOUT_PLAN_NAME,
    ...basePayload,
  }
}

export function buildChatGPTTrialCheckoutUrl(
  checkoutSessionId: string,
  processorEntity: string = DEFAULT_CHATGPT_TRIAL_CHECKOUT_PROCESSOR_ENTITY,
): string {
  const entity =
    processorEntity.trim() || DEFAULT_CHATGPT_TRIAL_CHECKOUT_PROCESSOR_ENTITY
  return `${CHATGPT_CHECKOUT_ORIGIN}/checkout/${encodeURIComponent(entity)}/${checkoutSessionId}`
}

const PROFILE_FIRST_NAMES = [
  'Alex',
  'Amelia',
  'Aria',
  'Ava',
  'Chloe',
  'Daniel',
  'Ethan',
  'Grace',
  'Harper',
  'Henry',
  'Isla',
  'Jack',
  'Leo',
  'Liam',
  'Lucas',
  'Mason',
  'Mia',
  'Noah',
  'Nora',
  'Owen',
  'Riley',
  'Sofia',
  'Theo',
  'Zoey',
] as const

const PROFILE_LAST_NAMES = [
  'Bennett',
  'Brooks',
  'Carter',
  'Clarke',
  'Cooper',
  'Davis',
  'Ellis',
  'Foster',
  'Graham',
  'Hayes',
  'Hughes',
  'Kelly',
  'Morgan',
  'Parker',
  'Reed',
  'Ross',
  'Russell',
  'Sawyer',
  'Taylor',
  'Turner',
  'Walker',
  'Ward',
  'West',
  'Wright',
] as const

export function buildProfileName(seed?: string): string {
  const normalizedSeed = seed?.trim().toLowerCase()
  if (!normalizedSeed) {
    return PROFILE_NAME
  }

  const digest = crypto.createHash('sha256').update(normalizedSeed).digest()
  const firstName =
    PROFILE_FIRST_NAMES[digest.readUInt16BE(0) % PROFILE_FIRST_NAMES.length] ||
    PROFILE_NAME.split(' ')[0]
  const lastName =
    PROFILE_LAST_NAMES[digest.readUInt16BE(2) % PROFILE_LAST_NAMES.length] ||
    PROFILE_NAME.split(' ')[1]

  return `${firstName} ${lastName}`
}

export function isChatGPTLoginUrl(url: string): boolean {
  return (
    url.startsWith(CHATGPT_ENTRY_LOGIN_URL) ||
    url.startsWith(CHATGPT_LOGIN_URL) ||
    url.startsWith(CHATGPT_LOGIN_V2_URL) ||
    url.startsWith(CHATGPT_OAUTH_LOGIN_URL) ||
    url.startsWith(CHATGPT_OAUTH_AUTHORIZE_URL)
  )
}

export function isChatGPTCodexConsentUrl(url: string): boolean {
  return url.startsWith(CHATGPT_CODEX_CONSENT_URL)
}

export function isChatGPTCodexOrganizationUrl(url: string): boolean {
  return url.startsWith(CHATGPT_CODEX_ORGANIZATION_URL)
}

export function isChatGPTCodexAccountConsentUrl(url: string): boolean {
  return url.startsWith(CHATGPT_CODEX_ACCOUNT_CONSENT_URL)
}

export const PASSWORD_INPUT_SELECTORS: SelectorTarget[] = [
  'input[type="password"]',
  'input[name="password"]',
]
export const PASSWORD_SUBMIT_SELECTORS: SelectorTarget[] = [
  'button[type="submit"]',
  { role: 'button', options: { name: /继续|continue|注册|create/i } },
  { text: /继续|continue|注册|create/i },
]
export const VERIFICATION_CODE_INPUT_SELECTORS: SelectorTarget[] = [
  'input#_r_5_-code',
  'input[autocomplete="one-time-code"]',
  'input[name="code"]',
  'input[name*="code"]',
  'input[id*="code"]',
]
export const PASSWORD_TIMEOUT_ERROR_SELECTORS: SelectorTarget[] = [
  {
    role: 'heading',
    options: { name: /糟糕，出错了！|oops[,，]?\s*an error occurred/i },
  },
  { text: /糟糕，出错了！|oops[,，]?\s*an error occurred/i },
  { text: /request id|请求\s*id|请求编号/i },
  { text: /operation timed out/i },
  'div:has-text("Operation timed out")',
]
export const PASSWORD_TIMEOUT_ERROR_TITLE_PATTERN =
  /糟糕，出错了！|oops[,，]?\s*an error occurred!?/i
export const ACCOUNT_DEACTIVATED_ERROR_SELECTORS: SelectorTarget[] = [
  { text: /account_deactivated/i },
  'div:has-text("account_deactivated")',
]
export const PASSWORD_TIMEOUT_RETRY_SELECTORS: SelectorTarget[] = [
  {
    role: 'button',
    options: { name: /重试|再次提交|重新提交|try again|retry|resubmit/i },
  },
  { text: /重试|再次提交|重新提交|try again|retry|resubmit/i },
  'button[data-dd-action-name="Try again"]',
]
export const REGISTRATION_EMAIL_SELECTORS: SelectorTarget[] = [
  'input[id$="-email"]',
  'input#email',
  'input[name="email"]',
  'input[type="email"]',
  { label: /电子邮件地址|email address|email/i },
  { placeholder: /电子邮件地址|email address|email/i },
]
export const REGISTRATION_CONTINUE_SELECTORS: SelectorTarget[] = [
  'button[type="submit"]',
  { role: 'button', options: { name: /继续|continue/i } },
  { text: /继续|continue/i },
]
export const LOGIN_EMAIL_SELECTORS: SelectorTarget[] = [
  'input[id$="-email"]',
  'input#email',
  'input[name="email"]',
  'input[type="email"]',
  { label: /电子邮件地址|email address|email/i },
  { placeholder: /电子邮件地址|email address|email/i },
]
export const LOGIN_CONTINUE_SELECTORS: SelectorTarget[] = [
  'form[action="/log-in-or-create-account"] button[type="submit"]',
  'button[type="submit"]',
  {
    role: 'button',
    options: { name: /继续|continue|next|login|log in|sign in/i },
  },
  { text: /继续|continue|next|login|log in|sign in/i },
]
export const CHATGPT_AUTHENTICATED_SELECTORS: SelectorTarget[] = [
  '[data-testid="accounts-profile-button"]',
  '[data-testid="composer-root"]',
  'textarea',
  '[data-testid="conversation-turn-0"]',
]
export const AGE_GATE_INPUT_SELECTORS: SelectorTarget[] = [
  'input[name="name"]',
  'input#_r_h_-name',
  'input#_r_v_-name',
  'input[id*="name"]',
  'input[name="age"]',
  'input#_r_h_-age',
  'input[id*="age"]',
  '[role="group"][id$="-birthday"]',
  '[role="spinbutton"][data-type="year"]',
  '[role="spinbutton"][data-type="month"]',
  '[role="spinbutton"][data-type="day"]',
]
export const AGE_GATE_NAME_SELECTORS: SelectorTarget[] = [
  'input[name="name"]',
  'input#_r_h_-name',
  'input#_r_v_-name',
  'input[id*="name"]',
]
export const AGE_GATE_AGE_SELECTORS: SelectorTarget[] = [
  'input[name="age"]',
  'input#_r_h_-age',
  'input[id*="age"]',
]
export const AGE_GATE_BIRTHDAY_GROUP_SELECTORS: SelectorTarget[] = [
  '[role="group"][id$="-birthday"]',
]
export const AGE_GATE_BIRTHDAY_TRIGGER_SELECTORS: SelectorTarget[] = [
  '[role="group"][id$="-birthday"]',
  { text: /生日日期|birth date|birthday/i },
  { text: /年\s*\/\s*月\s*\/\s*日|year\s*\/\s*month\s*\/\s*day/i },
]
export const AGE_GATE_BIRTHDAY_HIDDEN_INPUT_SELECTORS: SelectorTarget[] = [
  'input[name="birthday"]',
]
export const AGE_GATE_BIRTH_YEAR_SELECTORS: SelectorTarget[] = [
  '[role="spinbutton"][data-type="year"]',
  '[role="spinbutton"][aria-label*="年"]',
  '[role="spinbutton"][aria-label*="year" i]',
]
export const AGE_GATE_BIRTH_MONTH_SELECTORS: SelectorTarget[] = [
  '[role="spinbutton"][data-type="month"]',
  '[role="spinbutton"][aria-label*="月"]',
  '[role="spinbutton"][aria-label*="month" i]',
]
export const AGE_GATE_BIRTH_DAY_SELECTORS: SelectorTarget[] = [
  '[role="spinbutton"][data-type="day"]',
  '[role="spinbutton"][aria-label*="日"]',
  '[role="spinbutton"][aria-label*="day" i]',
]
export const COMPLETE_ACCOUNT_SELECTORS: SelectorTarget[] = [
  {
    role: 'button',
    options: {
      name: /完成帐户创建|完成账户创建|complete account creation|continue/i,
    },
  },
  { text: /完成帐户创建|完成账户创建|complete account creation|continue/i },
  'form[action="/about-you"] button[type="submit"]',
  'button[type="submit"]',
]
export const AGE_CONFIRM_SELECTORS: SelectorTarget[] = [
  { role: 'button', options: { name: /确定|confirm|ok/i } },
  { text: /确定|confirm|ok/i },
]
export const SIGNUP_ENTRY_SELECTORS: SelectorTarget[] = [
  '[data-testid="signup-button"]',
  { role: 'button', options: { name: /免费注册|sign up|create account/i } },
  { text: /免费注册|sign up|create account/i },
]
export const LOGIN_ENTRY_SELECTORS: SelectorTarget[] = [
  '[data-testid="login-button"]',
  { role: 'button', options: { name: /^登录$|^log in$|^login$/i } },
  { text: /^登录$|^log in$|^login$/i },
]
export const CODEX_WORKSPACE_SELECTORS: SelectorTarget[] = [
  'button[name="workspace_id"][value]',
  'input[type="radio"][name="workspace_id"]',
  'input[type="hidden"][name="workspace_id"]',
  'select[name="workspace_id"]',
  {
    role: 'heading',
    options: {
      name: /选择(?:一个)?工作(?:区|空间)|select a workspace|choose a workspace/i,
    },
  },
  {
    text: /选择(?:一个)?工作(?:区|空间)|select a workspace|choose a workspace/i,
  },
]
export const CODEX_WORKSPACE_SUBMIT_SELECTORS: SelectorTarget[] = [
  'form button[type="submit"]',
  'button[type="submit"]',
  {
    role: 'button',
    options: { name: /继续|continue|sign in|allow|authorize/i },
  },
  { text: /继续|continue|sign in|allow|authorize/i },
]
export const CODEX_ORGANIZATION_SELECTORS: SelectorTarget[] = [
  'input[type="radio"][name="organization_id"]',
  'input[type="hidden"][name="organization_id"]',
  'select[name="organization_id"]',
  'input[type="radio"][name="project_id"]',
  'input[type="hidden"][name="project_id"]',
  'select[name="project_id"]',
  {
    role: 'heading',
    options: {
      name: /api organization|select a project|wants access to your api organization/i,
    },
  },
  {
    text: /api organization|select a project|wants access to your api organization/i,
  },
]
export const CODEX_ORGANIZATION_SUBMIT_SELECTORS: SelectorTarget[] = [
  'form[action*="/api/accounts/organization/select"] button[type="submit"]',
  'form button[type="submit"]',
  'button[type="submit"]',
  'input[type="submit"]',
  {
    role: 'button',
    options: { name: /继续|continue|sign in|allow|authorize|approve/i },
  },
  { text: /继续|continue|sign in|allow|authorize|approve/i },
]
export const CODEX_CONSENT_SUBMIT_SELECTORS: SelectorTarget[] = [
  'form[action*="/api/accounts/consent"] button[type="submit"]',
  'form button[type="submit"]',
  'button[type="submit"]',
  'input[type="submit"]',
  {
    role: 'button',
    options: { name: /继续|continue|allow|authorize|accept|approve/i },
  },
  { text: /继续|continue|allow|authorize|accept|approve/i },
]
export const ONBOARDING_ACTION_CANDIDATES: Array<{
  text: string
  selectors: SelectorTarget[]
}> = [
  {
    text: 'getting-started',
    selectors: [
      '[data-testid="getting-started-button"]',
      {
        role: 'button',
        options: { name: /^好的，开始吧$|^开始吧$|^get started$/i },
      },
      { text: /^好的，开始吧$|^开始吧$|^get started$/i },
    ],
  },
  {
    text: 'continue',
    selectors: [
      {
        role: 'button',
        options: {
          name: /^继续$|^continue$|^下一步$|^next$|^改为使用个人帐户继续$|^continue with personal account$/i,
        },
      },
      {
        text: /^继续$|^continue$|^下一步$|^next$|^改为使用个人帐户继续$|^continue with personal account$/i,
      },
    ],
  },
  {
    text: 'continue-free',
    selectors: [
      {
        role: 'button',
        options: {
          name: /继续使用免费版|continue with free|continue using the free/i,
        },
      },
      {
        text: /继续使用免费版|continue with free|continue using the free/i,
      },
    ],
  },
  {
    text: 'done',
    selectors: [
      {
        role: 'button',
        options: {
          name: /^完成$|^done$/i,
        },
      },
      {
        text: /^完成$|^done$/i,
      },
    ],
  },
]
export const ONBOARDING_SIGNAL_SELECTORS: SelectorTarget[] = [
  '[data-testid="getting-started-button"]',
  {
    role: 'button',
    options: { name: /^好的，开始吧$|^开始吧$|^get started$/i },
  },
  { text: /^好的，开始吧$|^开始吧$|^get started$/i },
  {
    role: 'button',
    options: {
      name: /^继续$|^continue$|^下一步$|^next$|^改为使用个人帐户继续$|^continue with personal account$/i,
    },
  },
  {
    text: /^继续$|^continue$|^下一步$|^next$|^改为使用个人帐户继续$|^continue with personal account$/i,
  },
  {
    role: 'button',
    options: {
      name: /继续使用免费版|continue with free|continue using the free/i,
    },
  },
  {
    text: /继续使用免费版|continue with free|continue using the free/i,
  },
  {
    role: 'button',
    options: { name: /^完成$|^done$/i },
  },
  { text: /^完成$|^done$/i },
  {
    role: 'button',
    options: {
      name: /^跳过$|^跳过导览$|^skip$|^skip tour$|^not now$|^以后再说$|^稍后$|^稍后再说$|^暂时跳过$/i,
    },
  },
  {
    text: /^跳过$|^跳过导览$|^skip$|^skip tour$|^not now$|^以后再说$|^稍后$|^稍后再说$|^暂时跳过$/i,
  },
  {
    role: 'dialog',
    options: { name: /^新手引导$|^onboarding$/i },
  },
  {
    text: /你想使用 ChatGPT 做什么？|what do you want to use chatgpt for\?/i,
  },
  { text: /想要聊些什么？|what do you want to chat about\?/i },
  {
    text: /是什么促使你使用 ChatGPT？|what brings you to chatgpt\?/i,
  },
  {
    text: /你想使用 ChatGPT 做些什么？|what do you want to do with chatgpt\?/i,
  },
  { text: /以下是快速导览|here'?s a quick tour/i },
  { text: /你已准备就绪|you'?re all set!?/i },
  {
    text: /还有什么要告诉我的吗|anything else (?:you'?d|you would) like me to know\??/i,
  },
  { text: /看看 ChatGPT 能做些什么|see what chatgpt can do/i },
  { text: /立即试用|try now/i },
]

export function logStep(step: string, details?: Record<string, unknown>): void {
  logCliEvent('debug', 'chatgpt.step', {
    scope: 'chatgpt-login',
    step,
    ...details,
  })
}

function randomString(length = 8): string {
  return crypto
    .randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length)
}

export function buildPassword(): string {
  return `Codey!${randomString(10)}A1`
}

const CHATGPT_SUBJECT_CODE_PATTERN = /(\d(?:[\s-]?\d){5})\s*$/
const CHATGPT_BODY_CODE_PATTERNS = [
  /(?:verification\s*code|one(?:-| )?time\s*code|security\s*code|passcode|验证码|驗證碼|校验码|校驗碼|code)\D{0,24}(\d(?:[\s-]?\d){5})/i,
  /(\d(?:[\s-]?\d){5})\D{0,24}(?:verification\s*code|one(?:-| )?time\s*code|security\s*code|passcode|验证码|驗證碼|校验码|校驗碼|is\s+your\s+code|is\s+your\s+verification\s*code)/i,
]
const CHATGPT_TRAILING_CODE_PATTERN = /(\d(?:[\s-]?\d){5})\D*$/
const CHATGPT_ISOLATED_CODE_PATTERN = /\b(\d(?:[\s-]?\d){5})\b/g

function normalizeVerificationDigits(value: string): string {
  return value.replace(/[０-９]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0xfee0),
  )
}

function normalizeVerificationCandidate(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null
  }

  const digits = normalizeVerificationDigits(value).replace(/\D/g, '')
  return digits.length === 6 ? digits : null
}

function normalizeVerificationBody(value: string): string {
  return normalizeVerificationDigits(value)
    .replace(/=\r?\n/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|td|th|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
}

function extractTrailingCodeFromTail(value: string): string | null {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .reverse()

  for (const line of lines) {
    const isolatedCode = normalizeVerificationCandidate(
      line.match(/^\D*(\d(?:[\s-]?\d){5})\D*$/)?.[1],
    )
    if (isolatedCode) {
      return isolatedCode
    }

    const trailingCode = normalizeVerificationCandidate(
      line.match(/(\d(?:[\s-]?\d){5})(?!.*\d)/)?.[1],
    )
    if (trailingCode) {
      return trailingCode
    }
  }

  return null
}

export function extractChatGPTVerificationCodeFromSubject(
  subject: string | null | undefined,
): string | null {
  const normalized = subject?.trim()
  if (!normalized) {
    return null
  }

  const match = normalized.match(CHATGPT_SUBJECT_CODE_PATTERN)
  if (!match?.[1]) {
    return null
  }

  const digits = match[1].replace(/\D/g, '')
  return digits.length === 6 ? digits : null
}

export function extractChatGPTVerificationCodeFromBody(
  body: string | null | undefined,
): string | null {
  const normalized = body?.trim()
  if (!normalized) {
    return null
  }

  const cleaned = normalizeVerificationBody(normalized)
  const compact = cleaned.replace(/\s+/g, ' ').trim()

  for (const pattern of CHATGPT_BODY_CODE_PATTERNS) {
    const code = normalizeVerificationCandidate(compact.match(pattern)?.[1])
    if (code) {
      return code
    }
  }

  const tailCode = extractTrailingCodeFromTail(cleaned)
  if (tailCode) {
    return tailCode
  }

  const trailingCode = normalizeVerificationCandidate(
    compact.match(CHATGPT_TRAILING_CODE_PATTERN)?.[1],
  )
  if (trailingCode) {
    return trailingCode
  }

  const uniqueCodes = Array.from(
    compact.matchAll(CHATGPT_ISOLATED_CODE_PATTERN),
  )
    .map((match) => normalizeVerificationCandidate(match[1]))
    .filter((code): code is string => Boolean(code))
  const deduplicatedCodes = Array.from(new Set(uniqueCodes))

  return deduplicatedCodes.length === 1 ? deduplicatedCodes[0] : null
}

export function extractChatGPTVerificationCodeFromEmail(message: {
  subject?: string | null
  textBody?: string | null
  htmlBody?: string | null
  rawBody?: string | null
}): string | null {
  return (
    extractChatGPTVerificationCodeFromSubject(message.subject) ||
    extractChatGPTVerificationCodeFromBody(message.htmlBody) ||
    extractChatGPTVerificationCodeFromBody(message.textBody)
  )
}
