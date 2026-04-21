import fs from 'fs'
import path from 'path'

const WORKSPACE_MARKER = 'pnpm-workspace.yaml'

function hasWorkspaceMarker(directory: string): boolean {
  return fs.existsSync(path.join(directory, WORKSPACE_MARKER))
}

function resolveDirectory(inputPath: string): string {
  const resolved = path.resolve(inputPath)
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    return path.dirname(resolved)
  }
  return resolved
}

function findWorkspaceRoot(startPath: string): string | undefined {
  let current = resolveDirectory(startPath)

  while (true) {
    if (hasWorkspaceMarker(current)) {
      return current
    }

    const parent = path.dirname(current)
    if (parent === current) {
      return undefined
    }
    current = parent
  }
}

export function resolveWorkspaceRoot(fromPath: string): string {
  const configuredRoot = process.env.CODEY_WORKSPACE_ROOT?.trim()
  if (configuredRoot) {
    return path.resolve(configuredRoot)
  }

  const fileSystemWorkspaceRoot = findWorkspaceRoot(fromPath)
  if (fileSystemWorkspaceRoot) {
    return fileSystemWorkspaceRoot
  }

  const cwdWorkspaceRoot = findWorkspaceRoot(process.cwd())
  if (cwdWorkspaceRoot) {
    return cwdWorkspaceRoot
  }

  return process.cwd()
}
