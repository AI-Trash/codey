import os from 'os'
import path from 'path'

export interface ChromeProfileLaunchConfig {
  userDataDir: string
  profileDirectory: string
}

export interface ResolveChromeProfileLaunchConfigOptions {
  useDefaultProfile?: boolean
  profileDirectory?: string
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  homeDir?: string
}

function normalizeEnvPath(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function normalizeChromeProfileDirectory(
  value: string | undefined,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  return /^default$/i.test(trimmed) ? 'Default' : trimmed
}

export function resolveDefaultChromeUserDataDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  homeDir = os.homedir(),
): string {
  const explicitUserDataDir = normalizeEnvPath(env.CHROME_USER_DATA_DIR)
  if (explicitUserDataDir) {
    return explicitUserDataDir
  }

  if (platform === 'win32') {
    const localAppData =
      normalizeEnvPath(env.LOCALAPPDATA) ||
      path.join(homeDir, 'AppData', 'Local')
    return path.join(localAppData, 'Google', 'Chrome', 'User Data')
  }

  if (platform === 'darwin') {
    return path.join(
      homeDir,
      'Library',
      'Application Support',
      'Google',
      'Chrome',
    )
  }

  const xdgConfigHome =
    normalizeEnvPath(env.XDG_CONFIG_HOME) || path.join(homeDir, '.config')
  return path.join(xdgConfigHome, 'google-chrome')
}

export function resolveChromeProfileLaunchConfig(
  options: ResolveChromeProfileLaunchConfigOptions = {},
): ChromeProfileLaunchConfig | undefined {
  const normalizedProfileDirectory = normalizeChromeProfileDirectory(
    options.profileDirectory,
  )
  if (!options.useDefaultProfile && !normalizedProfileDirectory) {
    return undefined
  }

  return {
    userDataDir: resolveDefaultChromeUserDataDir(
      options.platform,
      options.env,
      options.homeDir,
    ),
    profileDirectory: normalizedProfileDirectory || 'Default',
  }
}
