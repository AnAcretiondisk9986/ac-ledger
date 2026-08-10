import { createClient, FileStat, WebDAVClient } from 'webdav';
import {
  StorageAdapter,
  StorageAuthError,
  StorageConflictError,
  StorageError,
  StorageNotFoundError,
  WriteOptions,
} from './types.js';
import { joinPath } from './encoding.js';

export interface WebDAVConfig {
  /** WebDAV 服务根地址，如 "https://dav.jianguoyun.com/dav/" */
  url: string;
  username?: string;
  password?: string;
  /** 或使用 token 认证（Bearer 类型） */
  token?: string;
  /** 数据所在目录，如 "AcLedger" */
  basePath?: string;
}

/** webdav 包运行时的错误形态：Error 且带 status 属性 */
interface HttpError extends Error {
  status?: number;
}

function isHttpError(e: unknown): e is HttpError {
  return e instanceof Error && 'status' in e && typeof (e as { status?: unknown }).status === 'number';
}

/**
 * WebDAV 适配器（支持坚果云等网盘）。
 * 用 etag 作为乐观锁（If-Match 条件写）。
 */
export class WebDAVAdapter implements StorageAdapter {
  readonly kind = 'webdav';
  private client: WebDAVClient;
  private ensuredDirs = new Set<string>();

  constructor(private readonly config: WebDAVConfig) {
    this.client = createClient(config.url, {
      username: config.username,
      password: config.password,
      token: config.token ? { access_token: config.token, token_type: 'Bearer' } : undefined,
    });
  }

  private fullPath(path: string): string {
    return joinPath(this.config.basePath, path);
  }

  private async ensureDir(path: string): Promise<void> {
    if (!path) return;
    const dirs: string[] = [];
    let cur = path;
    while (cur) {
      dirs.unshift(cur);
      const idx = cur.lastIndexOf('/');
      if (idx < 0) break;
      cur = cur.slice(0, idx);
    }
    for (const d of dirs) {
      if (this.ensuredDirs.has(d)) continue;
      try {
        if (!(await this.client.exists(d))) {
          await this.client.createDirectory(d);
        }
      } catch (e) {
        this.wrapError(e, `创建目录 ${d}`);
      }
      this.ensuredDirs.add(d);
    }
  }

  private wrapError(e: unknown, action: string): never {
    if (isHttpError(e)) {
      if (e.status === 401 || e.status === 403) throw new StorageAuthError(`WebDAV 认证失败（HTTP ${e.status}）`);
      if (e.status === 404) throw new StorageNotFoundError(`WebDAV 资源不存在: ${action}`);
      if (e.status === 412) throw new StorageConflictError(`WebDAV 并发冲突（HTTP 412）`);
      throw new StorageError(`WebDAV ${action} 失败（HTTP ${e.status}）`, e);
    }
    throw new StorageError(`WebDAV ${action} 失败`, e);
  }

  async readFile(path: string): Promise<string | null> {
    const p = this.fullPath(path);
    try {
      const content = await this.client.getFileContents(p, { format: 'text' });
      return typeof content === 'string' ? content : content.toString('utf8');
    } catch (e) {
      if (isHttpError(e) && e.status === 404) return null;
      this.wrapError(e, `读取 ${p}`);
    }
  }

  async writeFile(path: string, content: string, opts?: WriteOptions): Promise<void> {
    const p = this.fullPath(path);
    await this.ensureDir(this.dirOf(p));
    try {
      const headers: Record<string, string> = {};
      if (opts?.expectedSha) {
        // etag 需带引号
        headers['If-Match'] = opts.expectedSha.startsWith('"') ? opts.expectedSha : `"${opts.expectedSha}"`;
      }
      await this.client.putFileContents(p, content, { overwrite: true, headers });
    } catch (e) {
      this.wrapError(e, `写入 ${p}`);
    }
  }

  async listFiles(prefix = ''): Promise<{ path: string; sha?: string; size?: number; updatedAt?: string }[]> {
    const dir = this.fullPath(prefix) || '/';
    try {
      const items = await this.client.getDirectoryContents(dir);
      return items
        .filter((it): it is FileStat & { type: 'file' } => it.type === 'file')
        .map((it) => ({
          path: it.basename,
          sha: it.etag ? it.etag.replace(/^"|"$/g, '') : undefined,
          size: it.size,
          updatedAt: it.lastmod,
        }));
    } catch (e) {
      if (isHttpError(e) && e.status === 404) return [];
      this.wrapError(e, `列目录 ${dir}`);
    }
  }

  async deleteFile(path: string, opts?: WriteOptions): Promise<void> {
    const p = this.fullPath(path);
    try {
      await this.client.deleteFile(p);
    } catch (e) {
      if (isHttpError(e) && e.status === 404) return;
      this.wrapError(e, `删除 ${p}`);
    }
  }

  async testConnection(): Promise<void> {
    try {
      // 先验证 WebDAV 服务根目录；basePath 可以是首次使用时尚不存在的新目录。
      await this.client.getDirectoryContents('/');
    } catch (e) {
      this.wrapError(e, '连通性检查');
    }
    await this.ensureDir(this.fullPath(''));
  }

  private dirOf(path: string): string {
    const idx = path.lastIndexOf('/');
    return idx < 0 ? '' : path.slice(0, idx);
  }
}
