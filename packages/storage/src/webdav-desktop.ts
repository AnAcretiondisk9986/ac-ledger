import {
  FileInfo,
  StorageAdapter,
  StorageAuthError,
  StorageConflictError,
  StorageError,
  StorageNotFoundError,
  WriteOptions,
} from './types.js';
import { joinPath } from './encoding.js';

export interface DesktopWebDAVConfig {
  url: string;
  username?: string;
  password?: string;
  token?: string;
  basePath?: string;
}

export interface WebDAVBridgeResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export interface WebDAVRequestBridge {
  request(
    config: Omit<DesktopWebDAVConfig, 'basePath'>,
    request: { method: string; path: string; headers?: Record<string, string>; body?: string }
  ): Promise<WebDAVBridgeResponse>;
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/><d:getetag/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>`;

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function tagValue(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<(?:[\\w-]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, 'i'));
  return match?.[1] ? decodeXml(match[1].trim()) : undefined;
}

/** 解析 Depth: 1 PROPFIND 的直接文件项（兼容带/不带命名空间前缀）。 */
export function parseWebDAVDirectory(xml: string): FileInfo[] {
  const blocks = xml.match(/<(?:[\w-]+:)?response\b[\s\S]*?<\/(?:[\w-]+:)?response>/gi) ?? [];
  const files: FileInfo[] = [];
  for (const block of blocks) {
    if (/<(?:[\w-]+:)?collection\b/i.test(block)) continue;
    const href = tagValue(block, 'href');
    if (!href) continue;
    let pathname: string;
    try {
      pathname = new URL(href, 'http://webdav.local').pathname;
    } catch {
      pathname = href;
    }
    const encodedName = pathname.replace(/\/+$/, '').split('/').pop();
    if (!encodedName) continue;
    let name = encodedName;
    try {
      name = decodeURIComponent(encodedName);
    } catch {
      // 保留服务器返回的原始名称
    }
    const sizeText = tagValue(block, 'getcontentlength');
    const etag = tagValue(block, 'getetag')?.replace(/^"|"$/g, '');
    files.push({
      path: name,
      sha: etag || undefined,
      size: sizeText === undefined ? undefined : Number(sizeText),
      updatedAt: tagValue(block, 'getlastmodified'),
    });
  }
  return files;
}

/** Electron 专用 WebDAV 适配器：网络请求由主进程代理，不受浏览器 CORS 限制。 */
export class DesktopWebDAVAdapter implements StorageAdapter {
  readonly kind = 'webdav';
  private ensuredDirs = new Set<string>();

  constructor(
    private readonly config: DesktopWebDAVConfig,
    private readonly bridge: WebDAVRequestBridge
  ) {}

  private get bridgeConfig(): Omit<DesktopWebDAVConfig, 'basePath'> {
    const { basePath: _basePath, ...config } = this.config;
    return config;
  }

  private fullPath(path: string): string {
    return joinPath(this.config.basePath, path);
  }

  private async request(
    method: string,
    path: string,
    headers?: Record<string, string>,
    body?: string
  ): Promise<WebDAVBridgeResponse> {
    try {
      return await this.bridge.request(this.bridgeConfig, { method, path, headers, body });
    } catch (e) {
      throw new StorageError(`WebDAV ${method} 请求失败`, e);
    }
  }

  private assertStatus(response: WebDAVBridgeResponse, action: string, allowed: number[]): void {
    if (allowed.includes(response.status)) return;
    if (response.status === 401 || response.status === 403) {
      throw new StorageAuthError(`WebDAV 认证失败（HTTP ${response.status}）`);
    }
    if (response.status === 404) throw new StorageNotFoundError(`WebDAV 资源不存在: ${action}`);
    if (response.status === 412) throw new StorageConflictError('WebDAV 并发冲突（HTTP 412）');
    throw new StorageError(`WebDAV ${action} 失败（HTTP ${response.status} ${response.statusText}）`);
  }

  private async ensureDir(path: string): Promise<void> {
    if (!path) return;
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = joinPath(current, part);
      if (this.ensuredDirs.has(current)) continue;
      const check = await this.request('PROPFIND', current, { Depth: '0', 'Content-Type': 'application/xml' }, PROPFIND_BODY);
      if (check.status === 404) {
        const created = await this.request('MKCOL', current);
        this.assertStatus(created, `创建目录 ${current}`, [200, 201, 204, 405]);
      } else {
        this.assertStatus(check, `检查目录 ${current}`, [200, 207]);
      }
      this.ensuredDirs.add(current);
    }
  }

  async readFile(path: string): Promise<string | null> {
    const p = this.fullPath(path);
    const response = await this.request('GET', p);
    if (response.status === 404) return null;
    this.assertStatus(response, `读取 ${p}`, [200, 206]);
    return response.body;
  }

  async writeFile(path: string, content: string, opts?: WriteOptions): Promise<void> {
    const p = this.fullPath(path);
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    await this.ensureDir(dir);
    const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' };
    if (opts?.expectedSha) {
      headers['If-Match'] = opts.expectedSha.startsWith('"') ? opts.expectedSha : `"${opts.expectedSha}"`;
    }
    const response = await this.request('PUT', p, headers, content);
    this.assertStatus(response, `写入 ${p}`, [200, 201, 204]);
  }

  async listFiles(prefix = ''): Promise<FileInfo[]> {
    const p = this.fullPath(prefix);
    const response = await this.request(
      'PROPFIND',
      p,
      { Depth: '1', 'Content-Type': 'application/xml' },
      PROPFIND_BODY
    );
    if (response.status === 404) return [];
    this.assertStatus(response, `列目录 ${p || '/'}`, [200, 207]);
    return parseWebDAVDirectory(response.body);
  }

  async deleteFile(path: string, _opts?: WriteOptions): Promise<void> {
    const p = this.fullPath(path);
    const response = await this.request('DELETE', p);
    if (response.status === 404) return;
    this.assertStatus(response, `删除 ${p}`, [200, 204]);
  }

  async testConnection(): Promise<void> {
    const response = await this.request(
      'PROPFIND',
      '',
      { Depth: '0', 'Content-Type': 'application/xml' },
      PROPFIND_BODY
    );
    this.assertStatus(response, '连通性检查', [200, 207]);
    await this.ensureDir(this.fullPath(''));
  }
}
