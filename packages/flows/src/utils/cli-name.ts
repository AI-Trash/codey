import os from 'node:os'

const FALLBACK_CLI_NAME = 'codey'

export function getDefaultCliName(): string {
  const hostname = os.hostname().trim()
  return hostname || FALLBACK_CLI_NAME
}
