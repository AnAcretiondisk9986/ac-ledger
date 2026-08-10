/**
 * 本地文件系统适配器：数据以 JSON 文件存放在本机目录（离线可用）。
 *
 * 本模块不依赖 node:fs，浏览器/Electron 渲染进程均可安全引入；
 * Node 环境的默认 fs 实现见 ./local-node.js。
 */
import { StorageAdapter, StorageError, StorageNotFoundError, WriteOptions } from './types.js';
import { FileSystemOps } from './fs-ops.js';

export type { FileSystemOps } from './fs-ops.js';

export interface LocalAdapterOptions {
  rootDir: string;
  /** 文件系统实现（Node 用 ./local-node 的 nodeFileSystemOps；Electron 渲染进程注入 IPC 桥） */
  ops: FileSystemOps;
}

/** 本地目录适配器：与 GitHub/WebDAV 适配器接口一致 */
export class LocalAdapter implements StorageAdapter {
  readonly kind = 'local';
  private ops: FileSystemOps;

  constructor(
    private readonly options: LocalAdapterOptions
  ) {
    this.ops = options.ops;
  }

  /** 相对路径 → rootDir 下绝对路径（拒绝含 .. 的路径段，纯字符串实现，浏览器可用） */
  private resolve(rel: string): string {
    const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!clean || clean.split('/').some((s) => s === '..')) {
      throw new StorageError(`非法路径: ${rel}`);
    }
    return `${this.options.rootDir.replace(/\\/g, '/').replace(/\/+$/, '')}/${clean}`;
  }

  async readFile(path: string): Promise<string | null> {
    return this.ops.readFile(this.resolve(path));
  }

  async writeFile(path: string, content: string, _opts?: WriteOptions): Promise<void> {
    await this.ops.writeFile(this.resolve(path), content);
  }

  async listFiles(prefix = ''): Promise<{ path: string; sha?: string; size?: number }[]> {
    const dir = this.resolve(prefix || '.');
    const items = await this.ops.listFiles(dir);
    return items.map((f) => ({
      path: f.name,
      size: f.size,
      // 无版本概念；用 size+mtime 不参与乐观锁，本地单进程写入无需冲突控制
    }));
  }

  async deleteFile(path: string, _opts?: WriteOptions): Promise<void> {
    try {
      await this.ops.deleteFile(this.resolve(path));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new StorageError(`删除失败: ${path}`, e);
    }
  }

  async testConnection(): Promise<void> {
    await this.ops.testConnection(this.options.rootDir);
  }
}
