import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // monorepo 内包直接指向源码，免构建开发（子路径 alias 需在父路径之前）
      '@ac-ledger/storage/local-node': resolve(import.meta.dirname, '../../packages/storage/src/local-node.ts'),
      '@ac-ledger/storage/local': resolve(import.meta.dirname, '../../packages/storage/src/local.ts'),
      '@ac-ledger/core': resolve(import.meta.dirname, '../../packages/core/src/index.ts'),
      '@ac-ledger/storage': resolve(import.meta.dirname, '../../packages/storage/src/index.ts'),
      '@ac-ledger/bill-import': resolve(import.meta.dirname, '../../packages/bill-import/src/index.ts'),
    },
  },
  server: {
    port: 5173,
  },
  base: './', // GitHub Pages 部署用相对路径
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          antd: ['antd', '@ant-design/icons'],
          charts: ['recharts'],
        },
      },
    },
  },
});
