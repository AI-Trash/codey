export type FlowRuntime = 'browser' | 'android'

export type FlowFieldType = 'string' | 'number' | 'boolean' | 'select' | 'stringList'

export interface FlowFieldOption {
  value: string
  label: string
}

export interface FlowField {
  key: string
  label: string
  type: FlowFieldType
  group: 'common' | 'flow' | 'android'
  placeholder?: string
  options?: FlowFieldOption[]
}

export interface FlowDefinition {
  id: string
  label: string
  description: string
  runtime: FlowRuntime
  fields: FlowField[]
}

const browserCommonFields: FlowField[] = [
  {
    key: 'chromeDefaultProfile',
    label: 'Chrome Default Profile',
    type: 'boolean',
    group: 'common',
  },
  { key: 'proxyTag', label: 'Proxy Tag', type: 'string', group: 'common' },
  { key: 'headless', label: 'Headless', type: 'boolean', group: 'common' },
  { key: 'slowMo', label: 'Slow Motion (ms)', type: 'number', group: 'common' },
  { key: 'har', label: 'HAR', type: 'boolean', group: 'common' },
  {
    key: 'recordPageContent',
    label: 'Record Page HTML',
    type: 'boolean',
    group: 'common',
  },
  { key: 'record', label: 'Keep Browser Open', type: 'boolean', group: 'common' },
]

const androidCommonFields: FlowField[] = [
  { key: 'appiumServerUrl', label: 'Appium Server URL', type: 'string', group: 'android' },
  { key: 'androidUdid', label: 'Android UDID', type: 'string', group: 'android' },
  { key: 'androidDeviceName', label: 'Device Name', type: 'string', group: 'android' },
  {
    key: 'androidPlatformVersion',
    label: 'Platform Version',
    type: 'string',
    group: 'android',
  },
  {
    key: 'androidAutomationName',
    label: 'Automation Name',
    type: 'string',
    group: 'android',
  },
  { key: 'androidAppPackage', label: 'App Package', type: 'string', group: 'android' },
  { key: 'androidAppActivity', label: 'App Activity', type: 'string', group: 'android' },
  { key: 'androidNoReset', label: 'No Reset', type: 'boolean', group: 'android' },
  {
    key: 'codeyAndroidAppPackage',
    label: 'CodeyApp Package',
    type: 'string',
    group: 'android',
  },
]

const claimTrialField: FlowField = {
  key: 'claimTrial',
  label: 'Trial Payment',
  type: 'select',
  group: 'flow',
  options: [
    { value: 'gopay', label: 'GoPay' },
    { value: 'paypal', label: 'PayPal' },
  ],
}

const verificationFields: FlowField[] = [
  {
    key: 'verificationTimeoutMs',
    label: 'Verification Timeout (ms)',
    type: 'number',
    group: 'flow',
  },
  { key: 'pollIntervalMs', label: 'Poll Interval (ms)', type: 'number', group: 'flow' },
]

const identityFields: FlowField[] = [
  { key: 'identityId', label: 'Identity ID', type: 'string', group: 'flow' },
  { key: 'email', label: 'Email', type: 'string', group: 'flow' },
  {
    key: 'restoreStorageState',
    label: 'Restore Storage State',
    type: 'boolean',
    group: 'flow',
  },
]

const billingFields: FlowField[] = [
  { key: 'billingName', label: 'Billing Name', type: 'string', group: 'flow' },
  { key: 'billingCountry', label: 'Billing Country', type: 'string', group: 'flow' },
  {
    key: 'billingAddressLine1',
    label: 'Billing Address 1',
    type: 'string',
    group: 'flow',
  },
  {
    key: 'billingAddressLine2',
    label: 'Billing Address 2',
    type: 'string',
    group: 'flow',
  },
  { key: 'billingCity', label: 'Billing City', type: 'string', group: 'flow' },
  { key: 'billingState', label: 'Billing State', type: 'string', group: 'flow' },
  {
    key: 'billingPostalCode',
    label: 'Billing Postal Code',
    type: 'string',
    group: 'flow',
  },
]

function browserFlow(
  input: Omit<FlowDefinition, 'runtime' | 'fields'> & { fields?: FlowField[] },
): FlowDefinition {
  return {
    ...input,
    runtime: 'browser',
    fields: [...browserCommonFields, ...(input.fields || [])],
  }
}

function androidFlow(
  input: Omit<FlowDefinition, 'runtime' | 'fields'> & { fields?: FlowField[] },
): FlowDefinition {
  return {
    ...input,
    runtime: 'android',
    fields: [...androidCommonFields, ...(input.fields || [])],
  }
}

export const flowDefinitions: FlowDefinition[] = [
  browserFlow({
    id: 'chatgpt-register',
    label: 'ChatGPT Register',
    description: 'Create a new ChatGPT account and optionally claim a trial.',
    fields: [
      { key: 'password', label: 'Password', type: 'string', group: 'flow' },
      claimTrialField,
      ...verificationFields,
      ...billingFields,
    ],
  }),
  browserFlow({
    id: 'chatgpt-register-hosted-checkouts',
    label: 'Hosted Checkouts',
    description: 'Create an account and review hosted GoPay checkout links.',
    fields: [
      { key: 'password', label: 'Password', type: 'string', group: 'flow' },
      {
        key: 'hostedCheckoutCountry',
        label: 'Hosted Checkout Countries',
        type: 'stringList',
        group: 'flow',
      },
      {
        key: 'hostedCheckoutReview',
        label: 'Open Checkout Pages',
        type: 'boolean',
        group: 'flow',
      },
      ...verificationFields,
    ],
  }),
  browserFlow({
    id: 'chatgpt-login',
    label: 'ChatGPT Login',
    description: 'Sign in with a managed ChatGPT identity.',
    fields: identityFields,
  }),
  browserFlow({
    id: 'chatgpt-team-trial',
    label: 'Team Trial',
    description: 'Sign in and complete the ChatGPT Team trial checkout handoff.',
    fields: [...identityFields, claimTrialField, ...billingFields],
  }),
  browserFlow({
    id: 'chatgpt-team-trial-gopay',
    label: 'GoPay Continuation',
    description: 'Continue a captured Midtrans GoPay trial redirect.',
    fields: [
      {
        key: 'paymentRedirectUrl',
        label: 'Payment Redirect URL',
        type: 'string',
        group: 'flow',
      },
      { key: 'unlinkBeforeLink', label: 'Unlink First', type: 'boolean', group: 'flow' },
      { key: 'pollIntervalMs', label: 'Poll Interval (ms)', type: 'number', group: 'flow' },
      { key: 'androidUdid', label: 'Android UDID', type: 'string', group: 'flow' },
      {
        key: 'codeyAndroidAppPackage',
        label: 'CodeyApp Package',
        type: 'string',
        group: 'flow',
      },
    ],
  }),
  browserFlow({
    id: 'chatgpt-invite',
    label: 'Workspace Invite',
    description: 'Invite managed members into a ChatGPT workspace.',
    fields: [
      ...identityFields,
      { key: 'inviteEmail', label: 'Invite Emails', type: 'stringList', group: 'flow' },
      { key: 'inviteFile', label: 'Invite File', type: 'string', group: 'flow' },
      {
        key: 'pruneUnmanagedWorkspaceMembers',
        label: 'Prune Unmanaged Members',
        type: 'boolean',
        group: 'flow',
      },
    ],
  }),
  browserFlow({
    id: 'codex-oauth',
    label: 'Codex OAuth',
    description: 'Capture and share a Codex OAuth session.',
    fields: [
      { key: 'identityId', label: 'Identity ID', type: 'string', group: 'flow' },
      { key: 'email', label: 'Email', type: 'string', group: 'flow' },
      ...verificationFields,
      { key: 'workspaceId', label: 'Workspace ID', type: 'string', group: 'flow' },
      { key: 'workspaceIndex', label: 'Workspace Index', type: 'number', group: 'flow' },
      { key: 'redirectPort', label: 'Redirect Port', type: 'number', group: 'flow' },
      {
        key: 'authorizeUrlOnly',
        label: 'Authorize URL Only',
        type: 'boolean',
        group: 'flow',
      },
    ],
  }),
  androidFlow({
    id: 'android-healthcheck',
    label: 'Android Healthcheck',
    description: 'Open an Appium session and report connected device details.',
  }),
  browserFlow({
    id: 'noop',
    label: 'Noop Browser',
    description: 'Open a disposable browser window for manual inspection.',
  }),
]

export function getFlowDefinition(flowId: string): FlowDefinition | undefined {
  return flowDefinitions.find((flow) => flow.id === flowId)
}
