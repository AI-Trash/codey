import type { SelectorList } from '../../types';

export interface RegistrationSelectors {
  email: SelectorList;
  password: SelectorList;
  submit: SelectorList;
  organizationName?: SelectorList;
  inviteChild?: SelectorList;
  createPasskey?: SelectorList;
  passkeyDialogConfirm?: SelectorList;
}

export const registrationDefaults: {
  common: RegistrationSelectors;
  parent: Partial<RegistrationSelectors>;
  child: Partial<RegistrationSelectors>;
} = {
  common: {
    email: [
      { label: 'Email' },
      { label: '邮箱' },
      { placeholder: 'Email' },
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
      { role: 'button', options: { name: /sign up|register|create account|continue|next|注册|创建/i } },
      'button[type="submit"]',
      'input[type="submit"]',
    ],
  },
  parent: {
    organizationName: [
      { label: 'Organization' },
      { label: 'Company' },
      { label: '组织' },
      'input[name="organization"]',
      'input[name="company"]',
    ],
    inviteChild: [
      { role: 'button', options: { name: /invite|add member|create sub account|添加成员|邀请/i } },
    ],
  },
  child: {
    createPasskey: [
      { role: 'button', options: { name: /create passkey|set up passkey|continue with passkey|创建 passkey/i } },
      { text: /passkey/i },
    ],
    passkeyDialogConfirm: [{ role: 'button', options: { name: /continue|ok|allow|confirm|完成/i } }],
  },
};
