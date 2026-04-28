import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(rootDir, 'src')

export default defineConfig({
  resolve: {
    alias: {
      '#': srcDir,
      '@': srcDir,
    },
  },
  test: {
    environment: 'node',
    passWithNoTests: true,
  },
})
