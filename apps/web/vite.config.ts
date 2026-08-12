import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { createReadStream, existsSync } from 'node:fs';
import { cp, mkdir } from 'node:fs/promises';
import type { Plugin } from 'vite';

const OCR_FILES = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm', 'tesseract-core-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm', 'tesseract-core-relaxedsimd-lstm.wasm'],
  ['node_modules/@tesseract.js-data/chi_sim/4.0.0/chi_sim.traineddata.gz', 'chi_sim.traineddata.gz'],
] as const;

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../..');

/** OCR 运行文件始终来自已安装依赖：开发时本地响应，构建时复制进 dist。 */
function localOcrAssets(): Plugin {
  const byName = new Map<string, string>(OCR_FILES.map(([source, name]) => [name, resolve(WORKSPACE_ROOT, source)]));
  return {
    name: 'local-ocr-assets',
    configureServer(server) {
      server.middlewares.use('/ocr-assets', (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0] ?? '');
        const source = byName.get(name);
        if (!source || !existsSync(source)) return next();
        res.setHeader(
          'Content-Type',
          name.endsWith('.wasm')
            ? 'application/wasm'
            : name.endsWith('.js')
              ? 'text/javascript; charset=utf-8'
              : 'application/gzip'
        );
        createReadStream(source).pipe(res);
      });
    },
    async writeBundle(outputOptions) {
      const outputDir = outputOptions.dir;
      if (!outputDir) return;
      const targetDir = resolve(outputDir, 'ocr-assets');
      await mkdir(targetDir, { recursive: true });
      await Promise.all(OCR_FILES.map(([source, name]) => cp(resolve(WORKSPACE_ROOT, source), resolve(targetDir, name))));
    },
  };
}

export default defineConfig({
  plugins: [react(), localOcrAssets()],
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
