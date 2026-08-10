/**
 * 本地文件存储 IPC：主进程侧注册 fs 操作 handler。
 * 渲染进程只能操作 userData/ledger-data 目录内的相对路径（防逃逸）。
 */
const { ipcMain, app } = require('electron');
const fsp = require('node:fs/promises');
const path = require('node:path');

function getRootDir() {
  return path.join(app.getPath('userData'), 'ledger-data');
}

/** 校验相对路径并返回 rootDir 下的绝对路径 */
function resolveSafe(rel) {
  if (typeof rel !== 'string' || !rel) throw new Error('非法路径');
  const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.split('/').some((s) => s === '..')) throw new Error(`非法路径: ${rel}`);
  const abs = path.join(getRootDir(), ...clean.split('/'));
  const root = path.resolve(getRootDir());
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`非法路径: ${rel}`);
  return abs;
}

function registerFsIpc() {
  ipcMain.handle('ac-ledger:fs:root', () => getRootDir());

  ipcMain.handle('ac-ledger:fs:read', async (_e, rel) => {
    try {
      return await fsp.readFile(resolveSafe(rel), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  });

  ipcMain.handle('ac-ledger:fs:write', async (_e, rel, content) => {
    const abs = resolveSafe(rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, 'utf8');
  });

  ipcMain.handle('ac-ledger:fs:list', async (_e, rel) => {
    const abs = resolveSafe(rel || '.');
    const entries = await fsp.readdir(abs, { withFileTypes: true }).catch((err) => {
      if (err.code === 'ENOENT') return [];
      throw err;
    });
    const result = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      const stat = await fsp.stat(path.join(abs, e.name));
      result.push({ name: e.name, size: stat.size });
    }
    return result;
  });

  ipcMain.handle('ac-ledger:fs:delete', async (_e, rel) => {
    try {
      await fsp.unlink(resolveSafe(rel));
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
  });

  ipcMain.handle('ac-ledger:fs:test', async () => {
    await fsp.mkdir(getRootDir(), { recursive: true });
  });
}

module.exports = { registerFsIpc, getRootDir };
