import { createRequire } from 'node:module'
import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const outdir = resolve(root, 'dist-host')
const patchrightCoreRoot = resolve(
  dirname(require.resolve('patchright/package.json')),
  '../patchright-core',
)

await rm(outdir, { recursive: true, force: true })

await build({
  entryPoints: [resolve(root, 'src-host/automation-host.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  splitting: true,
  sourcemap: true,
  outdir,
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  alias: {
    '@codey/state-machine': '../state-machine/src/index.ts',
    'playwright-core/lib/zipBundle': `${patchrightCoreRoot}/lib/zipBundle.js`,
    'chromium-bidi/lib/cjs/bidiMapper/BidiMapper':
      './src-host/chromium-bidi-stub.ts',
    'chromium-bidi/lib/cjs/cdp/CdpConnection':
      './src-host/chromium-bidi-stub.ts',
  },
  banner: {
    js: [
      "import { createRequire as __codeyCreateRequire } from 'node:module';",
      "import { fileURLToPath as __codeyFileURLToPath } from 'node:url';",
      "import { dirname as __codeyDirname } from 'node:path';",
      'const require = __codeyCreateRequire(import.meta.url);',
      'const __filename = __codeyFileURLToPath(import.meta.url);',
      'const __dirname = __codeyDirname(__filename);',
    ].join(''),
  },
})
