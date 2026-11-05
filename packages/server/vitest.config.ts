import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests run against the core source, so they do not need a build first.
export default defineConfig({
  resolve: {
    alias: {
      '@rehearse/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
});
