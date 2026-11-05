import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// `base: './'` keeps asset URLs relative, so the same build works at `/`,
// behind `bb connect expose` and inside the bb panel iframe (R12).
export default defineConfig({
  base: './',
  plugins: [react()],
  // ELK is most of the bundle. The app is served from localhost, so one chunk is fine.
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2500 },
  // `pnpm dev`: API calls go to a running `rehearse serve` (default port 4700).
  server: { proxy: { '/api': process.env.REHEARSE_API ?? 'http://127.0.0.1:4700' } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globalSetup: ['./test/global-setup.ts'],
    alias: {
      '@rehearse/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@rehearse/server': fileURLToPath(new URL('../server/src/index.ts', import.meta.url)),
    },
  },
});
