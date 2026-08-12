import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
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
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // The server half of the tree runs in Node, not a browser: process, Buffer
    // and console are its own globals. Without this every server file reports
    // them as undefined, which buries the findings that matter.
    files: [
      'server.js',
      'ensure-indexes.js',
      'scripts/**/*.js',
      'src/routes/**/*.js',
      'src/models/**/*.js',
      'src/services/**/*.js',
      'src/jobs/**/*.js',
      'src/config/**/*.js',
      'src/middleware/**/*.js',
      // Named one by one rather than the whole of src/utils: most of it is
      // shared with the browser, and handing those files Node's globals would
      // let a stray process.env reach the client without the linter objecting.
      'src/utils/dailyReportPdf.js',
      'src/utils/pdfSigner.js',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
])
