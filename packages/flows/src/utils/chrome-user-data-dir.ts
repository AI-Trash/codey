import fs from 'fs/promises'
import os from 'os'
import path from 'path'

const PROFILE_EXCLUDED_TOP_LEVEL_NAMES = new Set([
  'Account Web Data',
  'Account Web Data-journal',
  'Accounts',
  'blob_storage',
  'Cache',
  'Code Cache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GCM Store',
  'GPUCache',
  'GrShaderCache',
  'JumpListIconsMostVisited',
  'JumpListIconsRecentClosed',
  'Login Data For Account',
  'Login Data For Account-journal',
  'Safe Browsing Network',
  'ShaderCache',
  'Sync Data',
  'trusted_vault.pb',
  'Web Data',
  'Web Data-journal',
])

const ROOT_METADATA_ALLOWLIST = new Set(['Local State'])

const TRANSIENT_FILE_NAMES = new Set(['LOCK', 'LOG', 'LOG.old'])

function splitRelativePath(relativePath: string): string[] {
  return relativePath.split(/[\\/]+/).filter(Boolean)
}

function isLockLikeChromeEntry(name: string): boolean {
  return (
    /^Singleton/i.test(name) ||
    /^lockfile/i.test(name) ||
    /\.lock$/i.test(name)
  )
}

export function shouldCopyChromeUserDataEntry(
  relativePath: string,
  profileDirectory?: string,
): boolean {
  const segments = splitRelativePath(relativePath)
  if (segments.length === 0) {
    return true
  }

  const leafName = segments[segments.length - 1] || ''
  if (
    isLockLikeChromeEntry(leafName) ||
    TRANSIENT_FILE_NAMES.has(leafName)
  ) {
    return false
  }

  const [topLevelName, ...rest] = segments
  if (!topLevelName) {
    return true
  }

  if (profileDirectory && topLevelName === profileDirectory) {
    if (rest.length === 0) {
      return true
    }

    // Skip caches plus account/sync stores that make remote-debugging launches
    // against a cloned profile exit immediately on recent Chrome builds.
    return !PROFILE_EXCLUDED_TOP_LEVEL_NAMES.has(rest[0] || '')
  }

  if (!profileDirectory) {
    return true
  }

  // Preserve a tiny set of root metadata that Chrome extensions and toolbar
  // state depend on, while still letting Chrome regenerate most live-profile
  // machine state for remote-debugging compatibility.
  return ROOT_METADATA_ALLOWLIST.has(topLevelName)
}

export interface CloneChromeUserDataDirToTempOptions {
  sourceUserDataDir: string
  profileDirectory?: string
}

export interface ClonedChromeUserDataDir {
  userDataDir: string
  profileDirectory?: string
  cleanup(): Promise<void>
}

export async function cloneChromeUserDataDirToTemp(
  options: CloneChromeUserDataDirToTempOptions,
): Promise<ClonedChromeUserDataDir> {
  const tempUserDataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codey-chrome-user-data-'),
  )

  try {
    await fs.cp(options.sourceUserDataDir, tempUserDataDir, {
      recursive: true,
      force: true,
      filter: (sourcePath) => {
        const relativePath = path.relative(
          options.sourceUserDataDir,
          sourcePath,
        )
        return shouldCopyChromeUserDataEntry(
          relativePath,
          options.profileDirectory,
        )
      },
    })
  } catch (error) {
    await fs.rm(tempUserDataDir, { recursive: true, force: true })
    throw error
  }

  return {
    userDataDir: tempUserDataDir,
    profileDirectory: options.profileDirectory,
    async cleanup() {
      await fs.rm(tempUserDataDir, { recursive: true, force: true })
    },
  }
}
