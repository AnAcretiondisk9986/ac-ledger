/**
 * 本地文件存储 IPC：主进程侧注册 fs 操作 handler。
 * 渲染进程只能操作用户选定的数据目录（默认 userData/ledger-data）内的路径。
 */
const { ipcMain, app, dialog } = require('electron');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');

let selectedRootDir;

function settingsPath() {
  return path.join(app.getPath('userData'), 'local-storage.json');
}

function loadSelectedRoot() {
  if (selectedRootDir !== undefined) return selectedRootDir;
  try {
    const value = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    selectedRootDir = typeof value?.rootDir === 'string' && value.rootDir ? path.resolve(value.rootDir) : null;
  } catch {
    selectedRootDir = null;
  }
  return selectedRootDir;
}

function saveSelectedRoot(rootDir) {
  selectedRootDir = path.resolve(rootDir);
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify({ rootDir: selectedRootDir }, null, 2), 'utf8');
}

function getRootDir() {
  return loadSelectedRoot() || path.join(app.getPath('userData'), 'ledger-data');
}

/** GitHub 双线存储的本地缓存根：userData/ledger-cache/<slug>（slug 按仓库隔离） */
function cacheRootFor(slug) {
  const safe = String(slug).replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(app.getPath('userData'), 'ledger-cache', safe);
}

/** 校验相对/绝对路径并保证它位于 rootDir 内 */
function resolveSafeUnder(root, rel) {
  if (typeof rel !== 'string' || !rel) throw new Error('非法路径');
  const abs = path.isAbsolute(rel)
    ? path.resolve(rel)
    : path.resolve(root, ...rel.replace(/\\/g, '/').split('/').filter(Boolean));
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`非法路径: ${rel}`);
  return abs;
}

function registerFsIpc() {
  ipcMain.handle('ac-ledger:fs:root', () => getRootDir());

  ipcMain.handle('ac-ledger:fs:select-root', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 Ac记账数据文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const root = path.resolve(result.filePaths[0]);
    await fsp.mkdir(root, { recursive: true });
    await fsp.access(root, fs.constants.R_OK | fs.constants.W_OK);
    saveSelectedRoot(root);
    return root;
  });

  ipcMain.handle('ac-ledger:fs:read', async (_e, rel) => {
    try {
      return await fsp.readFile(resolveSafeUnder(getRootDir(), rel), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  });

  ipcMain.handle('ac-ledger:fs:write', async (_e, rel, content) => {
    const abs = resolveSafeUnder(getRootDir(), rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, 'utf8');
  });

  ipcMain.handle('ac-ledger:fs:list', async (_e, rel) => {
    const abs = resolveSafeUnder(getRootDir(), rel || '.');
    return listDir(abs);
  });

  ipcMain.handle('ac-ledger:fs:delete', async (_e, rel) => {
    try {
      await fsp.unlink(resolveSafeUnder(getRootDir(), rel));
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
  });

  ipcMain.handle('ac-ledger:fs:test', async (_e, rel) => {
    const root = getRootDir();
    const target = rel ? resolveSafeUnder(root, rel) : root;
    await fsp.mkdir(target, { recursive: true });
    await fsp.access(target, fs.constants.R_OK | fs.constants.W_OK);
  });

  // —— GitHub 双线存储：本地缓存目录桥（按 slug 隔离，仅缓存读写，无删除外暴露） ——
  ipcMain.handle('ac-ledger:fs-cache:root', async (_e, slug) => {
    const root = cacheRootFor(slug);
    await fsp.mkdir(root, { recursive: true });
    return root;
  });

  ipcMain.handle('ac-ledger:fs-cache:read', async (_e, slug, rel) => {
    try {
      return await fsp.readFile(resolveSafeUnder(cacheRootFor(slug), rel), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  });

  ipcMain.handle('ac-ledger:fs-cache:write', async (_e, slug, rel, content) => {
    const abs = resolveSafeUnder(cacheRootFor(slug), rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, 'utf8');
  });

  ipcMain.handle('ac-ledger:fs-cache:list', async (_e, slug, rel) => {
    return listDir(resolveSafeUnder(cacheRootFor(slug), rel || '.'));
  });

  ipcMain.handle('ac-ledger:fs-cache:delete', async (_e, slug, rel) => {
    try {
      await fsp.unlink(resolveSafeUnder(cacheRootFor(slug), rel));
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
  });
}

/** 列出目录内文件（含 mtimeMs） */
async function listDir(abs) {
  const entries = await fsp.readdir(abs, { withFileTypes: true }).catch((err) => {
    if (err.code === 'ENOENT') return [];
    throw err;
  });
  const result = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const stat = await fsp.stat(path.join(abs, e.name));
    result.push({ name: e.name, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return result;
}

module.exports = { registerFsIpc, getRootDir };
