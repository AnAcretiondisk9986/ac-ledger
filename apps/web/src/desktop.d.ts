import type { FileSystemOps } from '@ac-ledger/storage/local';
import type { WebDAVRequestBridge } from '@ac-ledger/storage';

/** Electron 桌面端 preload 暴露的全局对象（仅桌面版存在） */
declare global {
  interface Window {
    acLedgerDesktop?: {
      platform: string;
      versions: { electron: string; chrome: string; node: string };
      isDesktop: boolean;
      /** 用系统默认浏览器打开外部链接 */
      openExternal(url: string): Promise<void>;
      /** GitHub 设备流（主进程转发，规避 CORS 限制） */
      deviceFlow?: {
        requestDeviceCode(clientId: string, scope?: string): Promise<unknown>;
        pollAccessToken(clientId: string, deviceCode: string): Promise<unknown>;
      };
      /** 主进程 WebDAV 请求桥 */
      webdav?: WebDAVRequestBridge;
      /** 无边框窗口控制桥（仅桌面版存在） */
      windowControls?: {
        minimize(): Promise<void>;
        toggleMaximize(): Promise<void>;
        close(): Promise<void>;
        /** 订阅最大化状态变化，返回取消订阅函数 */
        onMaximizedChange(cb: (maximized: boolean) => void): () => void;
      };
      /** GitHub 双线存储：本地缓存目录桥（slug 隔离在 userData/ledger-cache 下） */
      cacheStorage?: {
        rootDir(slug: string): Promise<string>;
        readFile(slug: string, rel: string): Promise<string | null>;
        writeFile(slug: string, rel: string, content: string): Promise<void>;
        listFiles(slug: string, rel: string): Promise<{ name: string; isDirectory?: boolean; size?: number; mtimeMs?: number }[]>;
        deleteFile(slug: string, rel: string): Promise<void>;
      };
      /** 退出同步桥：关闭窗口前提交 GitHub，成功后才退出 */
      sync?: {
        enable(enabled: boolean): Promise<void>;
        /** 订阅「准备退出」事件，返回取消订阅函数；回调内执行提交并调用 result() */
        onBeforeQuit(cb: () => void): () => void;
        result(ok: boolean, error?: string): Promise<void>;
      };
      /** 本地存储 IPC 桥（FileSystemOps + 数据目录查询） */
      storage: FileSystemOps & { rootDir(): Promise<string>; selectRootDir(): Promise<string | null> };
    };
  }
}

export {};
