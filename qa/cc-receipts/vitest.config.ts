import { defineConfig } from 'vitest/config';

// Opt-in accounting acceptance suite. Failing assertions are open defects,
// not expected failures or changes to the production application's rules.
export default defineConfig({
  test: {
    include: ['qa/cc-receipts/*.test.ts'],
    maxWorkers: 1,
    testTimeout: 15_000,
    hookTimeout: 60_000,
    restoreMocks: true
  }
});
