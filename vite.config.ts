import preact from '@preact/preset-vite';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [preact()],
  // Relative asset URLs, so the build works from any path (e.g. a hosted page).
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        debug: resolve(import.meta.dirname, 'debug.html'),
      },
    },
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
