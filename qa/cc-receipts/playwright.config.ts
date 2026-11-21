import { defineConfig } from 'playwright/test';
import base from '../../playwright.config.ts';

export default defineConfig({
  ...base,
  testDir: './browser',
  reporter: [['list'], ['json', { outputFile: 'results/browser.json' }]]
});
