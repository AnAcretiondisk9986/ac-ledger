/**
 * Node 环境的本地文件系统实现（node:fs）。
 * 仅 Node / Electron 主进程使用；浏览器端请勿引入。
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { FileSystemOps } from './fs-ops.js';
import { LocalAdapter } from './local.js';

export type { FileSystemOps } from './fs-ops.js';
export { LocalAdapter } from './local.js';

/** node:fs 默认实现 */
export const nodeFileSystemOps: FileSystemOps = {
  async readFile(absPath) {
    try {
      return await fsp.readFile(absPath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  },
  async writeFile(absPath, content) {
    await fsp.mkdir(path.dirname(absPath), { recursive: true });
    await fsp.writeFile(absPath, content, 'utf8');
  },
  async listFiles(absDir) {
    const entries = await fsp.readdir(absDir, { withFileTypes: true });
    const result: { name: string; isDirectory?: boolean; size?: number; mtimeMs?: number }[] = [];
    for (const e of entries) {
      if (e.isDirectory()) {
        result.push({ name: e.name, isDirectory: true });
        continue;
      }
      if (!e.isFile()) continue;
      const stat = await fsp.stat(path.join(absDir, e.name));
      result.push({ name: e.name, size: stat.size, mtimeMs: stat.mtimeMs });
    }
    return result;
  },
  async deleteFile(absPath) {
    await fsp.unlink(absPath);
  },
  async testConnection(absDir) {
    await fsp.mkdir(absDir, { recursive: true });
  },
};

/** 便捷：创建使用 node:fs 的本地适配器 */
export function createNodeLocalAdapter(rootDir: string, ops: FileSystemOps = nodeFileSystemOps): LocalAdapter {
  return new LocalAdapter({ rootDir, ops });
}
