import type { SelectorList } from '../../types'

export interface LoginSelectors {
  email: SelectorList
  password: SelectorList
  submit: SelectorList
  passkeyEntry?: SelectorList
}

export const loginDefaults: {
  common: LoginSelectors
  child: Partial<LoginSelectors>
} = {
  common: {
    email: [
      'input[id$="-email"]',
      { label: 'Email' },
      { label: '邮箱' },
      { label: '电子邮件地址' },
      { placeholder: '电子邮件地址' },
      'input[type="email"]',
      'input[name="email"]',
    ],
    password: [
      { label: 'Password' },
      { label: '密码' },
      'input[type="password"]',
      'input[name="password"]',
    ],
    submit: [
      {
        role: 'button',
        options: { name: /log in|login|sign in|continue|next|登录/i },
      },
      'button[type="submit"]',
      'input[type="submit"]',
    ],
  },
  child: {
    passkeyEntry: [
      {
        role: 'button',
        options: {
          name: /passkey|sign in with passkey|use a passkey|使用 passkey/i,
        },
      },
      { text: /passkey/i },
    ],
  },
}
