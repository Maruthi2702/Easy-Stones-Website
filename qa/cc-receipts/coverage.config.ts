import base from '../../vite.config.ts';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    maxWorkers: 2,
    testTimeout: 15_000,
    hookTimeout: 120_000,
    include: [
      'src/routes/cardReceipt*.test.ts', 'src/db/cardReceipts/*.test.ts',
      'src/features/cardReceipts/**/*.test.tsx',
      'src/utils/cardReceipts.test.ts', 'src/utils/cardReceiptSubcategories.test.ts',
      'src/utils/cardReceiptsWritesPause.test.ts', 'src/utils/receiptFile.test.ts',
      'src/utils/amexStatement.test.ts', 'src/utils/receiptScan.test.ts'
    ],
    coverage: {
      provider: 'v8',
      include: [
        'src/routes/cardReceipt*.ts', 'src/db/cardReceipts/*.ts', 'src/db/cardStatements/*.ts',
        'src/features/cardReceipts/**/*.{ts,tsx}', 'src/utils/cardReceipts.ts',
        'src/utils/cardReceiptsWritesPause.ts', 'src/utils/receiptFile.ts',
        'src/utils/amexStatement.ts', 'src/utils/receiptScan.ts', 'src/services/receiptScan.ts'
      ],
      exclude: ['**/*.test.ts', '**/*.test.tsx'],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'qa/cc-receipts/results/coverage'
    }
  }
});
