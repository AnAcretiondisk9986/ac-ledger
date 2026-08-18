/** 文件系统操作抽象：LocalAdapter 的底层依赖。
 * 默认用 node:fs；Electron 渲染进程可注入 IPC 桥实现（见 apps/desktop）。
 */
export interface FileSystemOps {
  readFile(absPath: string): Promise<string | null>;
  writeFile(absPath: string, content: string): Promise<void>;
  /** 列出目录内的条目（单层；目录条目用于由 LocalAdapter 递归遍历） */
  listFiles(absDir: string): Promise<{ name: string; isDirectory?: boolean; size?: number; mtimeMs?: number }[]>;
  deleteFile(absPath: string): Promise<void>;
  /** 目录可写检查 */
  testConnection(absDir: string): Promise<void>;
}
