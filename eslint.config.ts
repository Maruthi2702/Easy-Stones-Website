import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // ignoreRestSiblings: destructuring a field out just to omit it from a
      // ...rest copy (e.g. `const { assetValue, ...rest } = row`) is a
      // deliberate discard, not an unused variable — without this every such
      // omit pattern in the codebase reports an error on the omitted name.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', ignoreRestSiblings: true }],
    },
  },
  {
    // TypeScript (browser-only for now — MIGRATION_NOTES.md §1). tsc does the
    // type checking; this keeps the hooks rules and the same unused-vars rule.
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', ignoreRestSiblings: true }],
    },
  },
  {
    // The server half of the tree runs in Node, not a browser: process, Buffer
    // and console are its own globals. Without this every server file reports
    // them as undefined, which buries the findings that matter.
    files: [
      'server.ts',
      'ensure-indexes.ts',
      'scripts/**/*.ts',
      'src/routes/**/*.ts',
      'src/models/**/*.ts',
      'src/services/**/*.ts',
      'src/jobs/**/*.ts',
      'src/config/**/*.ts',
      'src/middleware/**/*.ts',
      // Named one by one rather than the whole of src/utils: most of it is
      // shared with the browser, and handing those files Node's globals would
      // let a stray process.env reach the client without the linter objecting.
      'src/utils/dailyReportPdf.ts',
      'src/utils/dailyReportSubmissionEmail.ts',
      'src/utils/pdfSigner.ts',
      // Holds the geocoding key and calls Google with it — server-side only,
      // which is exactly why it is named here rather than covered by a glob.
      'src/utils/geocode.ts',
      // node:worker_threads only exists in Node — these run an uploaded
      // file's parse off the main thread and are never reachable from the
      // browser bundle.
      'src/utils/runWorkbookParse.js',
      'src/utils/workbookParseWorker.js',
      // Shared API plumbing and Cart & Holds' server half. holdRules.js,
      // permissions.js and schemas.js are left out: the screens import them.
      'src/server/**/*.ts',
      'src/holds/router.ts',
      'src/holds/models.ts',
      'src/holds/expiry.ts',
      'src/holds/holdPdf.ts',
      'src/holds/*.test.ts',
      'src/accounting/ids.ts',
      'src/accounting/*.test.ts',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
])
