import { constants } from 'node:fs'
import { access, chmod, copyFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

const packageRoot = path.resolve(import.meta.dirname, '..')
const outputDir = path.join(packageRoot, 'dist-runtime')
const executableName = process.platform === 'win32' ? 'node.exe' : 'node'
const sourcePath = process.execPath
const targetPath = path.join(outputDir, executableName)

async function pathExists(candidate) {
  try {
    await access(candidate, constants.F_OK)
    return true
  } catch {
    return false
  }
}

await rm(outputDir, { recursive: true, force: true })
await mkdir(outputDir, { recursive: true })
await copyFile(sourcePath, targetPath)

if (process.platform !== 'win32') {
  await chmod(targetPath, 0o755)
}

if (!(await pathExists(targetPath))) {
  throw new Error(`Failed to prepare Node runtime at ${targetPath}`)
}

console.log(`Prepared Codey Desktop Node runtime: ${targetPath}`)
