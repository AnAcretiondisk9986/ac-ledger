/**
 * 预加载脚本：暴露平台信息与本地存储 IPC 桥。
 * 渲染进程仅能操作主进程限定的数据目录（userData/ledger-data）。
 */
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('acLedgerDesktop', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  isDesktop: true,
  /** 用系统默认浏览器打开外部链接（主进程校验协议后执行） */
  openExternal: (url) => invoke('ac-ledger:shell:open-external', url),
  /** GitHub 设备流（主进程转发，规避 github.com 无 CORS 头导致渲染进程 fetch 被拦截） */
  deviceFlow: {
    requestDeviceCode: (clientId, scope) => invoke('ac-ledger:device-flow:code', clientId, scope),
    pollAccessToken: (clientId, deviceCode) => invoke('ac-ledger:device-flow:token', clientId, deviceCode),
  },
  /** WebDAV 请求由主进程执行，避免渲染进程 CORS 限制 */
  webdav: {
    request: (config, request) => invoke('ac-ledger:webdav:request', config, request),
  },
  /** 窗口控制（无边框窗口的自绘最小化/最大化/关闭按钮） */
  windowControls: {
    minimize: () => invoke('ac-ledger:win:minimize'),
    toggleMaximize: () => invoke('ac-ledger:win:toggle-maximize'),
    close: () => invoke('ac-ledger:win:close'),
    onMaximizedChange: (cb) => {
      const listener = (_e, v) => cb(v);
      ipcRenderer.on('ac-ledger:win:maximized-changed', listener);
      return () => ipcRenderer.removeListener('ac-ledger:win:maximized-changed', listener);
    },
  },
  /** 本地文件存储（对应 FileSystemOps 接口，路径为数据目录内相对路径） */
  storage: {
    rootDir: () => invoke('ac-ledger:fs:root'),
    selectRootDir: () => invoke('ac-ledger:fs:select-root'),
    readFile: (rel) => invoke('ac-ledger:fs:read', rel),
    writeFile: (rel, content) => invoke('ac-ledger:fs:write', rel, content),
    listFiles: (rel) => invoke('ac-ledger:fs:list', rel),
    deleteFile: (rel) => invoke('ac-ledger:fs:delete', rel),
    testConnection: () => invoke('ac-ledger:fs:test'),
  },
});
