/**
 * 双线存储同步：本地工作副本 ↔ GitHub 仓库。
 *
 * - syncAll（打开软件时）：双向对比，交易文件按月并集合并，配置类文件取较新版本；
 * - pushAll（退出时）：本地 → 远端批量提交（带远端 sha 乐观锁，冲突不覆盖、留待下次 syncAll）。
 */
import { Transaction, TransactionsFile } from '@ac-ledger/core';
import { StorageAdapter } from './types.js';
import { blobSha } from './blob-sha.js';

export interface SyncSummary {
  /** 本地 → 远端（上传） */
  pushed: string[];
  /** 远端 → 本地（下载） */
  pulled: string[];
  /** 交易文件并集合并（两端都更新） */
  merged: string[];
  /** 失败的文件 */
  failed: { path: string; error: string }[];
}

interface LocalFile {
  path: string;
  content: string;
  sha: string;
  mtimeMs?: number;
}

function isTransactionFile(path: string): boolean {
  return path.startsWith('transactions/') && path.endsWith('.json');
}

function parseTransactions(content: string, label: string): Transaction[] {
  try {
    const file = JSON.parse(content) as TransactionsFile;
    if (!Array.isArray(file.transactions)) throw new Error('缺少 transactions 数组');
    return file.transactions;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`交易文件损坏，已停止同步以避免数据被覆盖: ${label}（${detail}）`);
  }
}

/** 交易并集（id/refId 去重，按日期倒序），与 repository 合并规则一致 */
function mergeTransactions(a: Transaction[], b: Transaction[]): Transaction[] {
  const byId = new Map<string, Transaction>();
  const refIds = new Set<string>();
  for (const t of [...a, ...b]) {
    if (!byId.has(t.id) && !(t.refId && refIds.has(t.refId))) {
      byId.set(t.id, t);
      if (t.refId) refIds.add(t.refId);
    }
  }
  return [...byId.values()].sort((x, y) => (x.date < y.date ? 1 : -1));
}

function serializeTransactions(month: string, transactions: Transaction[]): string {
  const file: TransactionsFile = { version: 1, month, transactions };
  return JSON.stringify(file, null, 2);
}

export class LedgerSync {
  constructor(
    private readonly remote: StorageAdapter,
    private readonly local: StorageAdapter,
    /** 远端文件最后提交时间（path → ms）；缺失时配置冲突默认以本地为准 */
    private readonly remoteDates: Map<string, number> = new Map()
  ) {}

  private async localFiles(fallbackPaths: Iterable<string> = []): Promise<LocalFile[]> {
    const items = await this.local.listFiles('');
    const out: LocalFile[] = [];
    const seen = new Set<string>();
    for (const it of items) {
      const content = await this.local.readFile(it.path);
      if (content === null) continue;
      out.push({ path: it.path, content, sha: await blobSha(content), mtimeMs: it.mtimeMs });
      seen.add(it.path);
    }
    // 防御性探测：即使某个适配器错误地漏报嵌套文件，也不能据此直接
    // 用远端版本覆盖本地。远端已知路径逐个 read 一次，找回漏报项。
    for (const path of fallbackPaths) {
      if (seen.has(path)) continue;
      const content = await this.local.readFile(path);
      if (content === null) continue;
      out.push({ path, content, sha: await blobSha(content) });
      seen.add(path);
    }
    return out;
  }

  /** 下载远端文件到本地 */
  private async pull(path: string, summary: SyncSummary): Promise<void> {
    const content = await this.remote.readFile(path);
    if (content === null) {
      summary.failed.push({ path, error: '远端文件已不存在' });
      return;
    }
    if (isTransactionFile(path)) parseTransactions(content, `远端 ${path}`);
    await this.local.writeFile(path, content);
    summary.pulled.push(path);
  }

  /** 上传本地文件到远端（带远端 sha 乐观锁） */
  private async push(path: string, content: string, remoteSha: string | undefined, summary: SyncSummary): Promise<void> {
    if (isTransactionFile(path)) parseTransactions(content, `本地 ${path}`);
    await this.remote.writeFile(path, content, remoteSha ? { expectedSha: remoteSha } : undefined);
    summary.pushed.push(path);
  }

  /** 交易文件并集合并：读取两端 → 合并 → 写回两端 */
  private async mergeTransactionFile(path: string, localContent: string, remoteSha: string, summary: SyncSummary): Promise<void> {
    const remoteContent = await this.remote.readFile(path);
    if (remoteContent === null) {
      // 远端已删除 → 直接上传本地版本
      await this.push(path, localContent, undefined, summary);
      return;
    }
    const month = path.slice('transactions/'.length, -'.json'.length);
    const merged = mergeTransactions(
      parseTransactions(localContent, `本地 ${path}`),
      parseTransactions(remoteContent, `远端 ${path}`)
    );
    const mergedJson = serializeTransactions(month, merged);
    await this.local.writeFile(path, mergedJson);
    await this.remote.writeFile(path, mergedJson, { expectedSha: remoteSha });
    summary.merged.push(path);
  }

  /** 双向同步（打开软件时调用）：本地领先上传、远端领先下载、交易并集、配置取新 */
  async syncAll(): Promise<SyncSummary> {
    const summary: SyncSummary = { pushed: [], pulled: [], merged: [], failed: [] };
    const remoteItems = await this.remote.listFiles('');
    const remoteMap = new Map(remoteItems.map((f) => [f.path, f.sha]));
    const locals = await this.localFiles(remoteMap.keys());
    const localMap = new Map(locals.map((f) => [f.path, f]));

    const allPaths = new Set<string>([...remoteMap.keys(), ...localMap.keys()]);
    for (const path of allPaths) {
      const remoteSha = remoteMap.get(path);
      const local = localMap.get(path);
      try {
        if (local && !remoteSha) {
          await this.push(path, local.content, undefined, summary);
        } else if (!local && remoteSha) {
          await this.pull(path, summary);
        } else if (local && remoteSha && local.sha !== remoteSha) {
          if (isTransactionFile(path)) {
            await this.mergeTransactionFile(path, local.content, remoteSha, summary);
          } else {
            // 配置/其他文件：取较新版本（远端最后提交时间 vs 本地修改时间）
            const remoteDate = this.remoteDates.get(path);
            const localMtime = local.mtimeMs ?? 0;
            const remoteNewer = remoteDate !== undefined && local.mtimeMs !== undefined && remoteDate > localMtime;
            if (remoteNewer) await this.pull(path, summary);
            else await this.push(path, local.content, remoteSha, summary);
          }
        }
        // sha 相同 → 两端一致，跳过
      } catch (e) {
        summary.failed.push({ path, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return summary;
  }

  /** 退出时提交：本地 → 远端。不删除远端多余文件；交易冲突并集后上传；其余冲突跳过留待下次 syncAll */
  async pushAll(): Promise<SyncSummary> {
    const summary: SyncSummary = { pushed: [], pulled: [], merged: [], failed: [] };
    const remoteItems = await this.remote.listFiles('');
    const remoteMap = new Map(remoteItems.map((f) => [f.path, f.sha]));
    const locals = await this.localFiles(remoteMap.keys());

    for (const local of locals) {
      const remoteSha = remoteMap.get(local.path);
      if (remoteSha === local.sha) continue; // 与远端一致
      try {
        if (isTransactionFile(local.path) && remoteSha) {
          await this.mergeTransactionFile(local.path, local.content, remoteSha, summary);
        } else {
          await this.push(local.path, local.content, remoteSha, summary);
        }
      } catch (e) {
        // 乐观锁冲突等：不覆盖远端，留待下次打开时 syncAll 处理
        summary.failed.push({ path: local.path, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return summary;
  }
}
