import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // 开发时直接指向源码，避免每次先构建 workspace 包
      '@ac-ledger/storage/local-node': resolve(import.meta.dirname, 'packages/storage/src/local-node.ts'),
      '@ac-ledger/storage/local': resolve(import.meta.dirname, 'packages/storage/src/local.ts'),
      '@ac-ledger/core': resolve(import.meta.dirname, 'packages/core/src/index.ts'),
      '@ac-ledger/storage': resolve(import.meta.dirname, 'packages/storage/src/index.ts'),
      '@ac-ledger/bill-import': resolve(import.meta.dirname, 'packages/bill-import/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
  },
});
