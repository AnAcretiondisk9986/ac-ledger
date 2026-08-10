/**
 * Ac记账 Electron 主进程。
 * - 开发模式：加载 @ac-ledger/web 的 vite dev server（http://localhost:5173）
 * - 生产模式：加载本地 renderer/index.html（file://，应用使用 HashRouter 无需服务器）
 */
const { app, BrowserWindow, ipcMain, shell, net, Menu, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { registerFsIpc } = require('./fs-ipc.cjs');
const { registerWebDAVIpc } = require('./webdav-ipc.cjs');

// 禁用硬件加速：规避 Windows 上 GPU 进程崩溃导致的纯白窗口（常见于驱动/远程桌面/虚拟机环境）
app.disableHardwareAcceleration();

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
const WEB_DIST = path.join(__dirname, 'renderer', 'index.html');

/** 主进程日志：同时输出控制台与 userData/ac-ledger.log（白屏排查用） */
const LOG_PATH = path.join(app.getPath('userData'), 'ac-ledger.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch {
    /* 日志写失败不影响运行 */
  }
}

function registerShellIpc() {
  // 安全打开外部链接（仅 http/https；渲染进程无 Node 权限）
  ipcMain.handle('ac-ledger:shell:open-external', async (_e, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      throw new Error(`拒绝打开非 http(s) 链接: ${url}`);
    }
    await shell.openExternal(url);
  });
}

/**
 * GitHub 设备流 IPC：请求改走主进程（net.fetch 走 Chromium 网络栈）。
 * 原因：github.com/login/device/* 端点不返回 CORS 头，渲染进程 fetch 必然被拦截。
 */
async function devicePost(url, body) {
  const res = await net.fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`GitHub 请求失败（HTTP ${res.status}）`);
  return res.json();
}

function registerDeviceFlowIpc() {
  ipcMain.handle('ac-ledger:device-flow:code', async (_e, clientId, scope) => {
    if (typeof clientId !== 'string' || !clientId) throw new Error('client_id 无效');
    return devicePost('https://github.com/login/device/code', { client_id: clientId, scope: scope || 'repo' });
  });
  ipcMain.handle('ac-ledger:device-flow:token', async (_e, clientId, deviceCode) => {
    if (typeof clientId !== 'string' || typeof deviceCode !== 'string') {
      throw new Error('参数无效');
    }
    return devicePost('https://github.com/login/oauth/access_token', {
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
  });
}

function registerWindowIpc() {
  ipcMain.handle('ac-ledger:win:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });
  ipcMain.handle('ac-ledger:win:toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle('ac-ledger:win:close', () => {
    if (mainWindow) mainWindow.close(); // 触发 close 事件 → app.quit()
  });
}

let mainWindow = null;

// —— GitHub 双线存储：退出时自动提交（渲染进程执行同步，主进程拦截 close 并等待结果） ——
let syncEnabled = false; // 渲染进程告知当前是否需要退出同步（仅桌面版 GitHub 模式为 true）
let syncInFlight = false;
let syncTimeout = null;

function registerSyncIpc() {
  ipcMain.handle('ac-ledger:sync:enable', (_e, enabled) => {
    syncEnabled = !!enabled;
    log(`sync: enabled=${syncEnabled}`);
  });

  ipcMain.handle('ac-ledger:sync:result', async (_e, ok, error) => {
    clearTimeout(syncTimeout);
    syncTimeout = null;
    syncInFlight = false;
    if (ok) {
      log('sync: committed, exiting');
      app.exit(0); // 直接退出，避免再次触发 close 拦截
      return;
    }
    await showSyncError(String(error ?? '未知错误'));
  });
}

/** 渲染进程提交失败/超时：弹窗提供 重试 / 强制退出 / 取消 */
async function showSyncError(detail) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    app.exit(1);
    return;
  }
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'error',
    title: '提交失败',
    message: '更改未能提交到 GitHub 仓库',
    detail: `${detail}\n\n（本地副本已保存，仍可安全退出，下次打开会自动重新提交）`,
    buttons: ['重试', '仍然退出（下次打开自动补交）', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (response === 0) {
    // 重试：重新发起同步
    syncInFlight = true;
    mainWindow.webContents.send('ac-ledger:sync:before-quit');
    armSyncTimeout();
  } else if (response === 1) {
    app.exit(0); // 强制退出：本地副本保留，下次打开时 syncAll 会补交
  }
  // response === 2：取消退出，窗口保持
}

function armSyncTimeout() {
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    syncInFlight = false;
    syncTimeout = null;
    void showSyncError('同步超时（渲染进程未响应）');
  }, 30000);
}

function beginQuitSync(win) {
  if (syncInFlight) return;
  syncInFlight = true;
  log('sync: before-quit requested');
  win.webContents.send('ac-ledger:sync:before-quit');
  armSyncTimeout();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Ac记账',
    frame: false, // 隐藏系统标题栏（ControlBox），窗口控制按钮自绘在界面内
    backgroundColor: '#f5f5f5',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;

  // 最大化/还原状态变化时通知渲染进程（自绘按钮切换图标）
  const sendMaximized = () => {
    if (!win.isDestroyed()) win.webContents.send('ac-ledger:win:maximized-changed', win.isMaximized());
  };
  win.on('maximize', sendMaximized);
  win.on('unmaximize', sendMaximized);

  // 禁用页面缩放（Ctrl+滚轮 / 触控板捏合），保持桌面应用观感
  win.webContents.setVisualZoomLevelLimits(1, 1);

  // 点击窗口关闭按钮（ControlBox X）→ 需要退出同步时先提交，成功后才真正退出
  win.on('close', (e) => {
    log('window close: checking sync');
    if (syncEnabled && !syncInFlight) {
      e.preventDefault();
      beginQuitSync(win);
      return;
    }
    log('window close: quitting app');
    app.quit();
  });

  // 页面就绪后再显示窗口，避免白屏闪烁
  win.once('ready-to-show', () => {
    log('ready-to-show');
    win.show();
  });

  // Ctrl+Shift+I / F12 打开开发者工具（排查问题时用）
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' || (input.key === 'I' && input.control && input.shift)) {
      win.webContents.toggleDevTools();
      log('devtools toggled');
    }
    // 禁用页面缩放快捷键（Ctrl+= / Ctrl+- / Ctrl+0），避免"网页感"
    if (input.control && ['=', '+', '-', '0'].includes(input.key)) {
      log(`zoom shortcut blocked: ${input.key}`);
    }
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // 生命周期与错误日志（白屏排查关键信息）
  win.webContents.on('did-finish-load', () => log(`did-finish-load ${win.webContents.getURL()}`));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log(`did-fail-load: ${code} ${desc} ${url}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    log(`render-process-gone: ${details.reason} (exitCode=${details.exitCode})`);
  });
  win.webContents.on('console-message', (_e, level, msg) => {
    log(`renderer[${level}]: ${String(msg).slice(0, 500)}`);
  });
  win.webContents.on('unresponsive', () => log('renderer unresponsive'));
  win.webContents.on('responsive', () => log('renderer responsive again'));

  // 打包后（app.isPackaged=true）一律加载本地文件；开发模式加载 vite dev server。
  // 不能用 NODE_ENV 判断——用户双击启动时没有该环境变量，会误走 dev server 导致白屏。
  if (!app.isPackaged) {
    log(`dev mode: load ${DEV_SERVER_URL}`);
    win.loadURL(DEV_SERVER_URL);
  } else {
    log(`packaged: load ${WEB_DIST}`);
    win.loadFile(WEB_DIST);
  }

  // 兜底：加载后 8 秒检查页面是否渲染出内容；没有则记录并自动重载一次
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const html = await win.webContents.executeJavaScript(
          `document.getElementById('root')?.innerHTML?.length ?? 0`
        );
        log(`render-check: root innerHTML length = ${html}`);
        if (typeof html === 'number' && html === 0) {
          log('render-check: EMPTY, reloading once');
          win.webContents.reload();
        }
      } catch (e) {
        log(`render-check error: ${e}`);
      }
    }, 8000);
  });

  // 冒烟测试：验证页面加载 + 本地存储 IPC 桥（写入/读回/删除）
  if (process.env.SMOKE_TEST) {
    win.webContents.once('did-finish-load', async () => {
      try {
        // 等待 React 挂载
        await new Promise((r) => setTimeout(r, 1500));
        const result = await win.webContents.executeJavaScript(`
          (async () => {
            const root = document.getElementById('root');
            const html = root ? root.innerHTML.slice(0, 300) : 'NO ROOT';
            const s = window.acLedgerDesktop;
            return {
              url: location.href,
              html,
              hasBridge: !!s,
              bridgeKeys: s ? Object.keys(s) : [],
              scripts: [...document.scripts].map(x => x.src),
            };
          })()
        `);
        log(`SMOKE_RENDER ${JSON.stringify(result)}`);
        const storage = await win.webContents.executeJavaScript(`
          (async () => {
            const s = window.acLedgerDesktop.storage;
            if (!s) return { error: 'storage bridge missing' };
            const root = await s.rootDir();
            const testContent = JSON.stringify({ smoke: Date.now() });
            await s.writeFile('smoke-test.json', testContent);
            const back = await s.readFile('smoke-test.json');
            await s.deleteFile('smoke-test.json');
            const files = await s.listFiles('.');
            return { root, roundtrip: back === testContent, fileCount: files.length };
          })()
        `);
        if (storage.error || !storage.roundtrip) {
          log(`SMOKE_FAIL ${JSON.stringify(storage)}`);
          app.exit(1);
          return;
        }
        log(`SMOKE_OK ${win.webContents.getURL()} ${JSON.stringify(storage)}`);
        setTimeout(() => app.quit(), 300);
      } catch (e) {
        log(`SMOKE_FAIL ${e}`);
        app.exit(1);
      }
    });
  }
}

// 单实例：防止残留进程/多开导致看到旧窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    log('second-instance: focus main window');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Windows 上移除默认应用菜单栏（File/Edit/View...），更像原生桌面应用
    if (process.platform === 'win32') Menu.setApplicationMenu(null);
    registerFsIpc();
    registerWebDAVIpc();
    registerShellIpc();
    registerDeviceFlowIpc();
    registerWindowIpc();
    registerSyncIpc();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
