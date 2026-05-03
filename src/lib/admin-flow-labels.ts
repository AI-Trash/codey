import type {
  CliFlowConfigFieldDefinition,
  CliFlowConfigFieldDescriptionKey,
  CliFlowConfigFieldDisplayNameKey,
  CliFlowDefinition,
  CliFlowDescriptionKey,
  CliFlowDisplayNameKey,
} from '../../packages/cli/src/modules/flow-cli/flow-registry'
import { m } from '#/paraglide/messages'

const flowDisplayNameMap: Record<CliFlowDisplayNameKey, () => string> = {
  chatgptRegister: () => m.admin_cli_flow_chatgpt_register_name(),
  chatgptLogin: () => m.admin_cli_flow_chatgpt_login_name(),
  chatgptTeamTrial: () => m.admin_cli_flow_chatgpt_team_trial_name(),
  chatgptTeamTrialGoPay: () => m.admin_cli_flow_chatgpt_team_trial_gopay_name(),
  chatgptInvite: () => m.admin_cli_flow_chatgpt_invite_name(),
  codexOauth: () => m.admin_cli_flow_codex_oauth_name(),
  androidHealthcheck: () => m.admin_cli_flow_android_healthcheck_name(),
  noop: () => m.admin_cli_flow_noop_name(),
}

const flowDescriptionMap: Record<CliFlowDescriptionKey, () => string> = {
  chatgptRegister: () => m.admin_cli_flow_chatgpt_register_description(),
  chatgptLogin: () => m.admin_cli_flow_chatgpt_login_description(),
  chatgptTeamTrial: () => m.admin_cli_flow_chatgpt_team_trial_description(),
  chatgptTeamTrialGoPay: () =>
    m.admin_cli_flow_chatgpt_team_trial_gopay_description(),
  chatgptInvite: () => m.admin_cli_flow_chatgpt_invite_description(),
  codexOauth: () => m.admin_cli_flow_codex_oauth_description(),
  androidHealthcheck: () => m.admin_cli_flow_android_healthcheck_description(),
  noop: () => m.admin_cli_flow_noop_description(),
}

const optionDisplayNameMap: Record<
  CliFlowConfigFieldDisplayNameKey,
  () => string
> = {
  chromeDefaultProfile: () => m.admin_cli_option_chrome_default_profile_name(),
  proxyTag: () => m.admin_cli_option_proxy_tag_name(),
  headless: () => m.admin_cli_option_headless_name(),
  slowMo: () => m.admin_cli_option_slow_mo_name(),
  har: () => m.admin_cli_option_har_name(),
  recordPageContent: () => m.admin_cli_option_record_page_content_name(),
  record: () => m.admin_cli_option_record_name(),
  restoreStorageState: () => m.admin_cli_option_restore_storage_state_name(),
  password: () => m.admin_cli_option_password_name(),
  claimTrial: () => m.admin_cli_option_claim_trial_name(),
  paymentRedirectUrl: () => m.admin_cli_option_payment_redirect_url_name(),
  verificationTimeoutMs: () => m.admin_cli_option_verification_timeout_name(),
  pollIntervalMs: () => m.admin_cli_option_poll_interval_name(),
  identityId: () => m.admin_cli_option_identity_id_name(),
  email: () => m.admin_cli_option_email_name(),
  billingName: () => m.admin_cli_option_billing_name_name(),
  billingCountry: () => m.admin_cli_option_billing_country_name(),
  billingAddressLine1: () => m.admin_cli_option_billing_address_line1_name(),
  billingAddressLine2: () => m.admin_cli_option_billing_address_line2_name(),
  billingCity: () => m.admin_cli_option_billing_city_name(),
  billingState: () => m.admin_cli_option_billing_state_name(),
  billingPostalCode: () => m.admin_cli_option_billing_postal_code_name(),
  inviteEmail: () => m.admin_cli_option_invite_email_name(),
  inviteFile: () => m.admin_cli_option_invite_file_name(),
  pruneUnmanagedWorkspaceMembers: () =>
    m.admin_cli_option_prune_unmanaged_workspace_members_name(),
  workspaceId: () => m.admin_cli_option_workspace_id_name(),
  workspaceIndex: () => m.admin_cli_option_workspace_index_name(),
  redirectPort: () => m.admin_cli_option_redirect_port_name(),
  authorizeUrlOnly: () => m.admin_cli_option_authorize_url_only_name(),
  appiumServerUrl: () => m.admin_cli_option_appium_server_url_name(),
  androidUdid: () => m.admin_cli_option_android_udid_name(),
  androidDeviceName: () => m.admin_cli_option_android_device_name_name(),
  androidPlatformVersion: () =>
    m.admin_cli_option_android_platform_version_name(),
  androidAutomationName: () =>
    m.admin_cli_option_android_automation_name_name(),
  androidAppPackage: () => m.admin_cli_option_android_app_package_name(),
  androidAppActivity: () => m.admin_cli_option_android_app_activity_name(),
  androidNoReset: () => m.admin_cli_option_android_no_reset_name(),
}

const optionDescriptionMap: Record<
  CliFlowConfigFieldDescriptionKey,
  () => string
> = {
  chromeDefaultProfile: () =>
    m.admin_cli_option_chrome_default_profile_description(),
  proxyTag: () => m.admin_cli_option_proxy_tag_description(),
  headless: () => m.admin_cli_option_headless_description(),
  slowMo: () => m.admin_cli_option_slow_mo_description(),
  har: () => m.admin_cli_option_har_description(),
  recordPageContent: () => m.admin_cli_option_record_page_content_description(),
  record: () => m.admin_cli_option_record_description(),
  restoreStorageState: () =>
    m.admin_cli_option_restore_storage_state_description(),
  password: () => m.admin_cli_option_password_description(),
  claimTrial: () => m.admin_cli_option_claim_trial_description(),
  paymentRedirectUrl: () =>
    m.admin_cli_option_payment_redirect_url_description(),
  verificationTimeoutMs: () =>
    m.admin_cli_option_verification_timeout_description(),
  pollIntervalMs: () => m.admin_cli_option_poll_interval_description(),
  identityId: () => m.admin_cli_option_identity_id_description(),
  email: () => m.admin_cli_option_email_description(),
  billingName: () => m.admin_cli_option_billing_name_description(),
  billingCountry: () => m.admin_cli_option_billing_country_description(),
  billingAddressLine1: () =>
    m.admin_cli_option_billing_address_line1_description(),
  billingAddressLine2: () =>
    m.admin_cli_option_billing_address_line2_description(),
  billingCity: () => m.admin_cli_option_billing_city_description(),
  billingState: () => m.admin_cli_option_billing_state_description(),
  billingPostalCode: () => m.admin_cli_option_billing_postal_code_description(),
  inviteEmail: () => m.admin_cli_option_invite_email_description(),
  inviteFile: () => m.admin_cli_option_invite_file_description(),
  pruneUnmanagedWorkspaceMembers: () =>
    m.admin_cli_option_prune_unmanaged_workspace_members_description(),
  workspaceId: () => m.admin_cli_option_workspace_id_description(),
  workspaceIndex: () => m.admin_cli_option_workspace_index_description(),
  redirectPort: () => m.admin_cli_option_redirect_port_description(),
  authorizeUrlOnly: () => m.admin_cli_option_authorize_url_only_description(),
  appiumServerUrl: () => m.admin_cli_option_appium_server_url_description(),
  androidUdid: () => m.admin_cli_option_android_udid_description(),
  androidDeviceName: () => m.admin_cli_option_android_device_name_description(),
  androidPlatformVersion: () =>
    m.admin_cli_option_android_platform_version_description(),
  androidAutomationName: () =>
    m.admin_cli_option_android_automation_name_description(),
  androidAppPackage: () => m.admin_cli_option_android_app_package_description(),
  androidAppActivity: () =>
    m.admin_cli_option_android_app_activity_description(),
  androidNoReset: () => m.admin_cli_option_android_no_reset_description(),
}

export function resolveFlowDisplayName(
  flowDefinition: CliFlowDefinition,
): string {
  return flowDisplayNameMap[flowDefinition.displayNameKey]()
}

export function resolveFlowDescription(
  flowDefinition: CliFlowDefinition,
): string {
  return flowDefinition.descriptionKey
    ? flowDescriptionMap[flowDefinition.descriptionKey]()
    : m.admin_cli_dispatch_flow_description()
}

export function getOptionDisplayName(
  option: CliFlowConfigFieldDefinition,
): string {
  return optionDisplayNameMap[option.displayNameKey]()
}

export function getOptionDescription(
  option: CliFlowConfigFieldDefinition,
): string {
  return option.descriptionKey
    ? optionDescriptionMap[option.descriptionKey]()
    : ''
}
