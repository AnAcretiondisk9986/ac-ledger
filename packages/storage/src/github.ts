import {
  StorageAdapter,
  StorageAuthError,
  StorageConflictError,
  StorageError,
  StorageNotFoundError,
  WriteOptions,
} from './types.js';
import { decodeBase64, encodeBase64, joinPath } from './encoding.js';

export interface GitHubConfig {
  /** 仓库所有者（用户或组织） */
  owner: string;
  /** 仓库名 */
  repo: string;
  /** GitHub Personal Access Token（需 repo 或 contents 权限） */
  token: string;
  /** 分支名，默认 "main" */
  branch?: string;
  /** 数据所在目录前缀，默认 ""（仓库根） */
  basePath?: string;
}

interface GitHubContentResponse {
  content?: string;
  sha: string;
  size?: number;
}

interface GitHubTreeItem {
  path: string;
  sha: string;
  size?: number;
  type: 'blob' | 'tree' | 'commit';
}

const API = 'https://api.github.com';

/** GitHub contents API 路径：按段编码，保留 "/" 分隔符 */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/**
 * GitHub 适配器：通过 REST Contents API 读写仓库文件。
 * 兼容 Node 18+（fetch）与浏览器（api.github.com 支持 CORS）。
 */
export class GitHubAdapter implements StorageAdapter {
  readonly kind = 'github';

  constructor(private readonly config: GitHubConfig) {}

  private get branch(): string {
    return this.config.branch ?? 'main';
  }

  private fullPath(path: string): string {
    return joinPath(this.config.basePath, path);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${this.config.token}`,
      'User-Agent': 'ac-ledger',
      ...extra,
    };
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<{ status: number; data: T }> {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: this.headers(body !== undefined ? { 'Content-Type': 'application/json' } : undefined),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new StorageError(`网络请求失败: ${url}`, e);
    }
    if (res.status === 204) return { status: res.status, data: undefined as T };
    let data: T;
    try {
      data = (await res.json()) as T;
    } catch {
      data = undefined as T;
    }
    if (res.ok) return { status: res.status, data };
    if (res.status === 401 || res.status === 403) {
      throw new StorageAuthError(`GitHub 认证失败（HTTP ${res.status}）`);
    }
    if (res.status === 404) {
      throw new StorageNotFoundError(`GitHub 资源不存在: ${url}`);
    }
    if (res.status === 409) {
      throw new StorageConflictError(`GitHub 并发冲突（HTTP 409）`);
    }
    const msg = (data as { message?: string } | undefined)?.message;
    throw new StorageError(`GitHub API 错误 ${res.status}: ${msg ?? url}`);
  }

  async readFile(path: string): Promise<string | null> {
    const p = this.fullPath(path);
    try {
      const { data } = await this.request<GitHubContentResponse>(
        'GET',
        `${API}/repos/${this.config.owner}/${this.config.repo}/contents/${encodePath(p)}?ref=${encodeURIComponent(this.branch)}`
      );
      return data.content ? decodeBase64(data.content) : null;
    } catch (e) {
      if (e instanceof StorageNotFoundError) return null;
      throw e;
    }
  }

  async writeFile(path: string, content: string, opts?: WriteOptions): Promise<void> {
    const p = this.fullPath(path);
    // 乐观锁：期望 sha 存在时先查询当前 sha，不匹配即冲突
    let currentSha: string | undefined = opts?.expectedSha;
    if (!currentSha) {
      try {
        const { data } = await this.request<GitHubContentResponse>(
          'GET',
          `${API}/repos/${this.config.owner}/${this.config.repo}/contents/${encodePath(p)}?ref=${encodeURIComponent(this.branch)}`
        );
        currentSha = data.sha;
      } catch (e) {
        if (!(e instanceof StorageNotFoundError)) throw e; // 文件不存在 → 新建
      }
    }
    const body: Record<string, unknown> = {
      message: opts?.message ?? `ac-ledger: update ${p}`,
      content: encodeBase64(content),
      branch: this.branch,
    };
    if (currentSha) body.sha = currentSha;
    await this.request('PUT', `${API}/repos/${this.config.owner}/${this.config.repo}/contents/${encodePath(p)}`, body);
  }

  async listFiles(prefix = ''): Promise<{ path: string; sha?: string; size?: number }[]> {
    const fullPrefix = this.fullPath(prefix);
    const { data } = await this.request<{ tree: GitHubTreeItem[]; truncated: boolean }>(
      'GET',
      `${API}/repos/${this.config.owner}/${this.config.repo}/git/trees/${encodeURIComponent(this.branch)}?recursive=1`
    );
    const items = data.tree.filter((t) => t.type === 'blob');
    if (!fullPrefix) {
      return items.map((t) => ({ path: t.path, sha: t.sha, size: t.size }));
    }
    return items
      .filter((t) => t.path.startsWith(fullPrefix + '/'))
      .map((t) => ({
        path: t.path.slice(fullPrefix.length + 1),
        sha: t.sha,
        size: t.size,
      }));
  }

  async deleteFile(path: string, opts?: WriteOptions): Promise<void> {
    const p = this.fullPath(path);
    let sha = opts?.expectedSha;
    if (!sha) {
      try {
        const { data } = await this.request<GitHubContentResponse>(
          'GET',
          `${API}/repos/${this.config.owner}/${this.config.repo}/contents/${encodePath(p)}?ref=${encodeURIComponent(this.branch)}`
        );
        sha = data.sha;
      } catch (e) {
        if (e instanceof StorageNotFoundError) return; // 已不存在，视为成功
        throw e;
      }
    }
    await this.request('DELETE', `${API}/repos/${this.config.owner}/${this.config.repo}/contents/${encodePath(p)}`, {
      message: opts?.message ?? `ac-ledger: delete ${p}`,
      sha,
      branch: this.branch,
    });
  }

  async testConnection(): Promise<void> {
    const { data } = await this.request<{ login?: string }>(
      'GET',
      `${API}/repos/${this.config.owner}/${this.config.repo}`
    );
    if (!data) throw new StorageError('GitHub 仓库不可访问');
  }
}
