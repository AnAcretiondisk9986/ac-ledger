import { StorageAdapter, StorageConflictError, StorageNotFoundError, WriteOptions } from './types.js';
import { joinPath } from './encoding.js';
import { blobSha } from './blob-sha.js';

/** 内存适配器：测试与演示用 */
export class MemoryAdapter implements StorageAdapter {
  readonly kind = 'memory';
  /** 文件路径 → 内容 */
  readonly files = new Map<string, string>();
  /** 文件路径 → 版本号（模拟 sha） */
  private readonly versions = new Map<string, string>();
  /** 文件路径 → 最后写入时间 */
  readonly mtimes = new Map<string, number>();

  constructor(initial?: Record<string, string>) {
    if (initial) {
      for (const [k, v] of Object.entries(initial)) this.files.set(k, v);
    }
  }

  async readFile(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async writeFile(path: string, content: string, opts?: WriteOptions): Promise<void> {
    if (opts?.expectedSha && this.versions.has(path) && this.versions.get(path) !== opts.expectedSha) {
      throw new StorageConflictError(`内存适配器冲突: ${path}`);
    }
    this.files.set(path, content);
    // 版本号 = 真实 blob sha，与 GitHub 语义一致（供 LedgerSync 对比测试）
    this.versions.set(path, await blobSha(content));
    this.mtimes.set(path, Date.now());
  }

  async listFiles(prefix = ''): Promise<{ path: string; sha?: string; size?: number; mtimeMs?: number }[]> {
    const p = prefix ? prefix.replace(/\/+$/, '') + '/' : '';
    return [...this.files.keys()]
      .filter((k) => k.startsWith(p))
      .map((k) => ({
        path: k.slice(p.length),
        sha: this.versions.get(k),
        size: this.files.get(k)?.length,
        mtimeMs: this.mtimes.get(k),
      }));
  }

  async deleteFile(path: string): Promise<void> {
    if (!this.files.delete(path)) throw new StorageNotFoundError(`文件不存在: ${path}`);
    this.versions.delete(path);
    this.mtimes.delete(path);
  }

  async testConnection(): Promise<void> {
    // 内存后端始终可用
  }
}

/** 便捷：构造带数据的 MemoryAdapter（自动加前缀路径） */
export function memoryAdapterWith(basePath: string, files: Record<string, string>): MemoryAdapter {
  const init: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) init[joinPath(basePath, k)] = v;
  return new MemoryAdapter(init);
}
