/**
 * 构建 electron-builder 的独立 app 目录（apps/desktop/app）：
 * - 拷贝主进程文件（main/preload/fs-ipc）
 * - 拷贝 Web 构建产物到 app/renderer
 * - 写入精简 package.json（无 devDependencies，避免 electron-builder 在 workspace 里跑 npm install）
 */
const fsp = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'app');
const WEB_DIST = path.join(ROOT, '..', 'web', 'dist');

const APP_PACKAGE = {
  name: 'ac-ledger-desktop',
  version: '0.1.0',
  description: 'Ac记账 桌面版',
  author: 'AcLedger',
  main: 'main.cjs',
  dependencies: {},
};

async function main() {
  // 清空并重建 app 目录
  await fsp.rm(APP_DIR, { recursive: true, force: true });
  await fsp.mkdir(path.join(APP_DIR, 'renderer'), { recursive: true });

  await fsp.writeFile(path.join(APP_DIR, 'package.json'), JSON.stringify(APP_PACKAGE, null, 2));
  for (const f of ['main.cjs', 'preload.cjs', 'fs-ipc.cjs', 'webdav-ipc.cjs']) {
    await fsp.copyFile(path.join(ROOT, f), path.join(APP_DIR, f));
  }
  await fsp.cp(WEB_DIST, path.join(APP_DIR, 'renderer'), { recursive: true });
  console.log(`app 目录就绪: ${APP_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
