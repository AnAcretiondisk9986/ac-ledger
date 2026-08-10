/**
 * 存储适配层：文件级接口 + 多种后端实现（GitHub / WebDAV / 内存）。
 *
 * 所有文件均为 UTF-8 文本（JSON），路径用 "/" 分隔、相对数据根目录。
 */

/** 文件信息（列目录结果） */
export interface FileInfo {
  path: string;
  /** 后端提供的版本标识（如 GitHub 的 blob sha），写回时用于乐观锁 */
  sha?: string;
  size?: number;
  /** 最后修改时间（本地后端用，版本对比） */
  mtimeMs?: number;
  updatedAt?: string;
}

export interface WriteOptions {
  /** 乐观锁：期望的当前 sha；不匹配时抛 StorageConflictError */
  expectedSha?: string;
  /** 提交信息（Git 类后端用） */
  message?: string;
}

/** 存储后端抽象 */
export interface StorageAdapter {
  readonly kind: 'github' | 'webdav' | 'memory' | string;

  /** 读取文件；不存在返回 null */
  readFile(path: string): Promise<string | null>;

  /** 写入文件（自动创建父目录） */
  writeFile(path: string, content: string, opts?: WriteOptions): Promise<void>;

  /** 列出前缀下的所有文件 */
  listFiles(prefix?: string): Promise<FileInfo[]>;

  /** 删除文件 */
  deleteFile(path: string, opts?: WriteOptions): Promise<void>;

  /** 连通性检查（配置/凭证是否正确） */
  testConnection(): Promise<void>;
}

/** 存储错误基类 */
export class StorageError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

/** 并发冲突（乐观锁 sha 不匹配，远端已被修改） */
export class StorageConflictError extends StorageError {
  constructor(message = '远端文件已被修改，请刷新后重试') {
    super(message);
    this.name = 'StorageConflictError';
  }
}

/** 凭证无效 / 无权限 */
export class StorageAuthError extends StorageError {
  constructor(message = '认证失败：请检查令牌与权限') {
    super(message);
    this.name = 'StorageAuthError';
  }
}

/** 文件不存在 */
export class StorageNotFoundError extends StorageError {
  constructor(message = '文件不存在') {
    super(message);
    this.name = 'StorageNotFoundError';
  }
}
