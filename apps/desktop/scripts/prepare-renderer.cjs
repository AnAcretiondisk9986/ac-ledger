/**
 * 将 Web 构建产物拷贝到 desktop/renderer（electron-builder 打包内容）。
 */
const fsp = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const webDist = path.join(__dirname, '..', '..', 'web', 'dist');
  const target = path.join(__dirname, '..', 'renderer');
  await fsp.rm(target, { recursive: true, force: true });
  await fsp.cp(webDist, target, { recursive: true });
  console.log(`renderer 就绪: ${webDist} -> ${target}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
