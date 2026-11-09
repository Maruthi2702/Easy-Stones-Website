// Tests for the scripts/ tools (vite.config.ts only collects src/**):
//   npx vitest run --config scripts/vitest.scripts.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/**/*.test.ts'],
    environment: 'node'
  }
});
