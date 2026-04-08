import { defineConfig } from 'vite';
import path from 'path';
import { builtinModules } from 'module';

export default defineConfig({
  build: {
    target: 'node22',
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: 'src/cli.ts',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [...builtinModules,
      ...builtinModules.map((m) => `node:${m}`), 'patchright']
    },
  },
});
