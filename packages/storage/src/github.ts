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
  private resolvedBranch: string;
  private branchExists: boolean | null = null;
  private defaultBranch = 'main';
  /** 文件 sha 缓存：写前免查询，PUT/DELETE 成功后更新，冲突/404 时清除 */
  private shaCache = new Map<string, string>();

  constructor(private readonly config: GitHubConfig) {
    this.resolvedBranch = config.branch?.trim() || 'main';
  }

  private get branch(): string {
    return this.resolvedBranch;
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
    if (res.status === 422 && msg && /sha|already exists/i.test(msg)) {
      throw new StorageConflictError(`GitHub 并发冲突：${msg}`);
    }
    throw new StorageError(`GitHub API 错误 ${res.status}: ${msg ?? url}`);
  }

  async readFile(path: string): Promise<string | null> {
    if (this.branchExists === false) return null;
    const p = this.fullPath(path);
    try {
      const { data } = await this.request<GitHubContentResponse>(
        'GET',
        `${API}/repos/${this.config.owner}/${this.config.repo}/contents/${encodePath(p)}?ref=${encodeURIComponent(this.branch)}`
      );
      if (data.sha) this.shaCache.set(p, data.sha);
      return data.content ? decodeBase64(data.content) : null;
    } catch (e) {
      if (e instanceof StorageNotFoundError) {
        this.shaCache.delete(p);
        return null;
      }
      throw e;
    }
  }

  async writeFile(path: string, content: string, opts?: WriteOptions): Promise<void> {
    const p = this.fullPath(path);
    // 乐观锁：期望 sha 存在时优先用缓存，缓存未命中才查询当前 sha
    let currentSha: string | undefined = opts?.expectedSha ?? this.shaCache.get(p);
    if (!currentSha && this.branchExists !== false) {
      try {
        const { data } = await this.request<GitHubContentResponse>(
          'GET',
          `${API}/repos/${this.config.owner}/${this.config.repo}/contents/${encodePath(p)}?ref=${encodeURIComponent(this.branch)}`
        );
        currentSha = data.sha;
        if (data.sha) this.shaCache.set(p, data.sha);
      } catch (e) {
        if (!(e instanceof StorageNotFoundError)) throw e; // 文件不存在 → 新建
        this.shaCache.delete(p);
      }
    }
    const body: Record<string, unknown> = {
      message: opts?.message ?? `ac-ledger: update ${p}`,
      content: encodeBase64(content),
    };
    // 空仓库尚无分支：首个 Contents API 写入不能携带 ref，由 GitHub 创建默认分支。
    if (this.branchExists !== false) body.branch = this.branch;
    if (currentSha) body.sha = currentSha;
    try {
      const { data } = await this.request<{ content?: { sha?: string } }>(
        'PUT',
        `${API}/repos/${this.config.owner}/${this.config.repo}/contents/${encodePath(p)}`,
        body
      );
      this.branchExists = true;
      const newSha = data.content?.sha;
      if (newSha) this.shaCache.set(p, newSha);
      else this.shaCache.delete(p);
    } catch (e) {
      // 冲突后缓存失效，重试时会重新读取远端 sha
      this.shaCache.delete(p);
      throw e;
    }
  }

  async listFiles(prefix = ''): Promise<{ path: string; sha?: string; size?: number }[]> {
    if (this.branchExists === false) return [];
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

  /** 最近提交的文件时间表（数据目录相对路径 → 最后提交时间 ms），用于本地↔远端版本对比 */
  async getCommitDates(perPage = 50): Promise<Map<string, number>> {
    if (this.branchExists === false) return new Map();
    const { data } = await this.request<
      { commit: { committer: { date: string } }; files?: { filename: string }[] }[]
    >(
      'GET',
      `${API}/repos/${this.config.owner}/${this.config.repo}/commits?sha=${encodeURIComponent(this.branch)}&per_page=${perPage}`
    );
    const base = this.config.basePath?.replace(/\\/g, '/').replace(/\/+$/, '') ?? '';
    const map = new Map<string, number>();
    for (const c of data) {
      const t = Date.parse(c.commit.committer.date);
      for (const f of c.files ?? []) {
        const rel = base && f.filename.startsWith(base + '/') ? f.filename.slice(base.length + 1) : f.filename;
        if (!map.has(rel)) map.set(rel, t);
      }
    }
    return map;
  }

  async deleteFile(path: string, opts?: WriteOptions): Promise<void> {
    if (this.branchExists === false) return;
    const p = this.fullPath(path);
    let sha = opts?.expectedSha ?? this.shaCache.get(p);
    if (!sha) {
      try {
        const { data } = await this.request<GitHubContentResponse>(
          'GET',
          `${API}/repos/${this.config.owner}/${this.config.repo}/contents/${encodePath(p)}?ref=${encodeURIComponent(this.branch)}`
        );
        sha = data.sha;
        if (data.sha) this.shaCache.set(p, data.sha);
      } catch (e) {
        if (e instanceof StorageNotFoundError) {
          this.shaCache.delete(p);
          return; // 已不存在，视为成功
        }
        throw e;
      }
    }
    await this.request('DELETE', `${API}/repos/${this.config.owner}/${this.config.repo}/contents/${encodePath(p)}`, {
      message: opts?.message ?? `ac-ledger: delete ${p}`,
      sha,
      branch: this.branch,
    });
    this.shaCache.delete(p);
  }

  async testConnection(): Promise<void> {
    const { data } = await this.request<{ default_branch?: string; size?: number }>(
      'GET',
      `${API}/repos/${this.config.owner}/${this.config.repo}`
    );
    if (!data) throw new StorageError('GitHub 仓库不可访问');
    this.defaultBranch = data.default_branch || 'main';
    this.resolvedBranch = this.config.branch?.trim() || this.defaultBranch;
    try {
      await this.request(
        'GET',
        `${API}/repos/${this.config.owner}/${this.config.repo}/git/ref/heads/${encodePath(this.branch)}`
      );
      this.branchExists = true;
    } catch (e) {
      // GitHub 对空仓库的 git/ref 请求返回 409（而非 404）。只有确认仓库为空时才按首次初始化处理。
      const emptyRepository = Number(data.size ?? -1) === 0;
      if (!(e instanceof StorageNotFoundError) && !(emptyRepository && e instanceof StorageConflictError)) throw e;
      if (this.branch !== this.defaultBranch) {
        throw new StorageNotFoundError(`GitHub 分支不存在: ${this.branch}`);
      }
      this.branchExists = false;
    }
  }
}
