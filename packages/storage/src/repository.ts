import {
  AccountsFile,
  AutoCategoryRules,
  CategoriesFile,
  Category,
  Account,
  LedgerFile,
  Transaction,
  TransactionsFile,
  defaultCategories,
  uuid,
} from '@ac-ledger/core';
import { StorageAdapter, StorageConflictError, StorageError } from './types.js';

const LEDGER_PATH = 'ledger.json';
const ACCOUNTS_PATH = 'accounts.json';
const CATEGORIES_PATH = 'categories.json';
const SETTINGS_PATH = 'settings.json';

function monthFile(month: string): string {
  return `transactions/${month}.json`;
}

export interface InitLedgerOptions {
  name: string;
  currency?: string;
}

export interface AddResult {
  added: number;
  skipped: number;
}

export interface UpdateResult {
  updated: number;
  skipped: number;
}

/** settings.json 内容：自动分类自定义规则等 */
export interface SettingsFile {
  version: 1;
  autoCategoryRules?: AutoCategoryRules;
}

/** 读 JSON 文件；不存在返回 null；损坏抛 StorageError */
async function readJson<T>(adapter: StorageAdapter, path: string): Promise<T | null> {
  const raw = await adapter.readFile(path);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    throw new StorageError(`数据文件损坏: ${path}`, e);
  }
}

/**
 * 账本仓库：对 StorageAdapter 的领域封装。
 * - 交易按月分片存储 transactions/YYYY-MM.json
 * - 写冲突（乐观锁失败）时自动拉取远端合并后重试
 */
export class LedgerRepository {
  constructor(
    private readonly adapter: StorageAdapter,
    private readonly conflictRetries = 2
  ) {}

  /** 初始化账本：不存在 ledger.json 时创建默认账本+分类 */
  async initLedger(opts: InitLedgerOptions): Promise<LedgerFile> {
    let ledgerFile = await this.getLedger();
    if (!ledgerFile) {
      const now = new Date().toISOString();
      ledgerFile = {
        version: 1,
        ledger: {
          id: `ledger-${uuid().slice(0, 8)}`,
          name: opts.name,
          currency: opts.currency ?? 'CNY',
          createdAt: now,
          updatedAt: now,
        },
      };
      await this.adapter.writeFile(LEDGER_PATH, JSON.stringify(ledgerFile, null, 2), {
        message: 'ac-ledger: init ledger',
      });
    }

    // 每次连接都补齐基础文件，可修复上次中断留下的半初始化仓库。
    if ((await readJson<AccountsFile>(this.adapter, ACCOUNTS_PATH)) === null) {
      const accountFile: AccountsFile = { version: 1, accounts: [] };
      await this.adapter.writeFile(ACCOUNTS_PATH, JSON.stringify(accountFile, null, 2), {
        message: 'ac-ledger: init accounts',
      });
    }
    if ((await readJson<CategoriesFile>(this.adapter, CATEGORIES_PATH)) === null) {
      const catFile: CategoriesFile = { version: 1, categories: defaultCategories() };
      await this.adapter.writeFile(CATEGORIES_PATH, JSON.stringify(catFile, null, 2), {
        message: 'ac-ledger: init categories',
      });
    }
    return ledgerFile;
  }

  async getLedger(): Promise<LedgerFile | null> {
    return readJson<LedgerFile>(this.adapter, LEDGER_PATH);
  }

  async getAccounts(): Promise<Account[]> {
    const f = await readJson<AccountsFile>(this.adapter, ACCOUNTS_PATH);
    return f?.accounts ?? [];
  }

  async saveAccounts(accounts: Account[]): Promise<void> {
    const file: AccountsFile = { version: 1, accounts };
    await this.adapter.writeFile(ACCOUNTS_PATH, JSON.stringify(file, null, 2));
  }

  async getCategories(): Promise<Category[]> {
    const f = await readJson<CategoriesFile>(this.adapter, CATEGORIES_PATH);
    return f?.categories ?? [];
  }

  async saveCategories(categories: Category[]): Promise<void> {
    const file: CategoriesFile = { version: 1, categories };
    await this.adapter.writeFile(CATEGORIES_PATH, JSON.stringify(file, null, 2));
  }

  /** 读取设置（settings.json）；不存在返回 null */
  async getSettings(): Promise<SettingsFile | null> {
    return readJson<SettingsFile>(this.adapter, SETTINGS_PATH);
  }

  /** 保存设置（settings.json） */
  async saveSettings(settings: SettingsFile): Promise<void> {
    await this.adapter.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  }

  /** 读取某月交易 */
  async getMonthTransactions(month: string): Promise<Transaction[]> {
    const f = await readJson<TransactionsFile>(this.adapter, monthFile(month));
    return f?.transactions ?? [];
  }

  /** 读取一段时间（含端点）的交易；缺省为全部 */
  async getTransactions(fromMonth?: string, toMonth?: string): Promise<Transaction[]> {
    const files = await this.adapter.listFiles('transactions/');
    const months = files
      .map((f) => f.path.replace(/\.json$/, ''))
      .filter((m) => /^\d{4}-\d{2}$/.test(m))
      .filter((m) => (!fromMonth || m >= fromMonth) && (!toMonth || m <= toMonth))
      .sort();
    const result: Transaction[] = [];
    for (const m of months) {
      result.push(...(await this.getMonthTransactions(m)));
    }
    return result;
  }

  /** 列出所有有交易的月份 */
  async listMonths(): Promise<string[]> {
    const files = await this.adapter.listFiles('transactions/');
    return files
      .map((f) => f.path.replace(/\.json$/, ''))
      .filter((m) => /^\d{4}-\d{2}$/.test(m))
      .sort();
  }

  /** 新增一笔交易（按 id 去重；写入对应月份文件） */
  async addTransaction(tx: Transaction): Promise<void> {
    await this.addTransactions([tx]);
  }

  /** 批量新增（按 id 与 refId 去重），返回实际新增/跳过数量 */
  async addTransactions(list: Transaction[]): Promise<AddResult> {
    if (list.length === 0) return { added: 0, skipped: 0 };
    const byMonth = new Map<string, Transaction[]>();
    for (const tx of list) {
      const month = tx.date.slice(0, 7);
      const arr = byMonth.get(month) ?? [];
      arr.push(tx);
      byMonth.set(month, arr);
    }
    let added = 0;
    let skipped = 0;
    for (const [month, txs] of byMonth) {
      const { added: a, skipped: s } = await this.mergeMonth(month, txs, 'insert');
      added += a;
      skipped += s;
    }
    return { added, skipped };
  }

  /** 更新一笔交易（按 id 定位；不存在则忽略） */
  async updateTransaction(tx: Transaction): Promise<void> {
    const month = tx.date.slice(0, 7);
    await this.mergeMonth(month, [tx], 'update');
  }

  /** 批量更新（按 id 定位；不存在则忽略），跨月分片一次读一次写 */
  async updateTransactions(list: Transaction[]): Promise<UpdateResult> {
    if (list.length === 0) return { updated: 0, skipped: 0 };
    const byMonth = new Map<string, Transaction[]>();
    for (const tx of list) {
      const month = tx.date.slice(0, 7);
      const arr = byMonth.get(month) ?? [];
      arr.push(tx);
      byMonth.set(month, arr);
    }
    let updated = 0;
    let skipped = 0;
    for (const [month, txs] of byMonth) {
      const r = await this.mergeMonth(month, txs, 'update');
      updated += r.added;
      skipped += r.skipped;
    }
    return { updated, skipped };
  }

  /** 删除一笔交易 */
  async removeTransaction(id: string): Promise<void> {
    const months = await this.listMonths();
    for (const month of months) {
      const txs = await this.getMonthTransactions(month);
      if (!txs.some((t) => t.id === id)) continue;
      const remaining = txs.filter((t) => t.id !== id);
      await this.writeMonthFile(month, remaining);
      return;
    }
  }

  private async mergeMonth(
    month: string,
    incoming: Transaction[],
    mode: 'insert' | 'update'
  ): Promise<AddResult> {
    let added = 0;
    let skipped = 0;
    const run = async (): Promise<void> => {
      const current = await this.getMonthTransactions(month);
      const byId = new Map(current.map((t) => [t.id, t]));
      const refIds = new Set(current.filter((t) => t.refId).map((t) => t.refId));

      if (mode === 'insert') {
        for (const tx of incoming) {
          if (byId.has(tx.id) || (tx.refId && refIds.has(tx.refId))) {
            skipped++;
            continue;
          }
          byId.set(tx.id, tx);
          if (tx.refId) refIds.add(tx.refId);
          added++;
        }
      } else {
        for (const tx of incoming) {
          if (byId.has(tx.id)) {
            byId.set(tx.id, tx);
            added++;
          } else {
            skipped++;
          }
        }
      }
      const merged = [...byId.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
      await this.writeMonthFile(month, merged);
    };
    await this.withConflictRetry(run);
    return { added, skipped };
  }

  /** 写月份文件（带冲突重试：冲突时以远端为准重新合并一次） */
  private async writeMonthFile(month: string, transactions: Transaction[]): Promise<void> {
    const file: TransactionsFile = { version: 1, month, transactions };
    const content = JSON.stringify(file, null, 2);
    await this.withConflictRetry(async () => {
      await this.adapter.writeFile(monthFile(month), content, { message: `ac-ledger: update ${month}` });
    });
  }

  /** 乐观锁冲突时重试的包装器（重试会重新读取远端，保证合并基于最新数据） */
  private async withConflictRetry(fn: () => Promise<void>): Promise<void> {
    for (let attempt = 0; attempt <= this.conflictRetries; attempt++) {
      try {
        await fn();
        return;
      } catch (e) {
        if (!(e instanceof StorageConflictError) || attempt >= this.conflictRetries) throw e;
      }
    }
  }
}
