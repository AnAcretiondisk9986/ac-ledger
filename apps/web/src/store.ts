import { create } from 'zustand';
import { Account, Category, LedgerFile, Transaction, applyAutoCategory } from '@ac-ledger/core';
import {
  AddResult,
  DesktopWebDAVAdapter,
  GitHubAdapter,
  LedgerRepository,
  StorageAdapter,
  StorageError,
  WebDAVAdapter,
} from '@ac-ledger/storage';
import { LocalAdapter } from '@ac-ledger/storage/local';
import { ensureLedgerRepo, fetchGithubUser } from './github-oauth';

export type StorageKind = 'github' | 'webdav' | 'local';

export type StorageConfig =
  | {
      kind: 'github';
      owner: string;
      repo: string;
      token: string;
      branch?: string;
      basePath?: string;
    }
  | { kind: 'webdav'; url: string; username?: string; password?: string; basePath?: string }
  | { kind: 'local'; rootDir: string };

const CONFIG_KEY = 'ac-ledger:storage-config';

let connectionAttempt = 0;
let autoConnectPromise: Promise<void> | null = null;

export function loadSavedConfig(): StorageConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? (JSON.parse(raw) as StorageConfig) : null;
  } catch {
    return null;
  }
}

export function saveConfig(config: StorageConfig | null): void {
  if (config) localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  else localStorage.removeItem(CONFIG_KEY);
}

/** 根据配置创建适配器 */
export function createAdapter(config: StorageConfig): StorageAdapter {
  if (config.kind === 'github') {
    return new GitHubAdapter({
      owner: config.owner ?? '',
      repo: config.repo ?? '',
      token: config.token ?? '',
      branch: config.branch || undefined,
      basePath: config.basePath || '',
    });
  }
  if (config.kind === 'webdav') {
    const bridge = typeof window !== 'undefined' ? window.acLedgerDesktop?.webdav : undefined;
    if (bridge) {
      return new DesktopWebDAVAdapter(
        {
          url: config.url ?? '',
          username: config.username || undefined,
          password: config.password || undefined,
          basePath: config.basePath || '',
        },
        bridge
      );
    }
    return new WebDAVAdapter({
      url: config.url ?? '',
      username: config.username || undefined,
      password: config.password || undefined,
      basePath: config.basePath || '',
    });
  }
  // local：仅桌面版可用，通过 preload 的 IPC 桥访问数据目录
  const desktop = window.acLedgerDesktop;
  if (!desktop?.storage) throw new Error('本地存储仅在桌面版可用');
  return new LocalAdapter({ rootDir: config.rootDir, ops: desktop.storage });
}

interface AppState {
  status: 'unconfigured' | 'connecting' | 'ready' | 'error';
  error: string | null;
  config: StorageConfig | null;
  repo: LedgerRepository | null;
  ledger: LedgerFile | null;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  months: string[];

  /** 用配置连接并初始化账本 */
  connect(config: StorageConfig): Promise<void>;
  /**
   * GitHub 一键连接：设备流授权拿到 token 后，
   * 自动获取用户名 → 确保数据仓库存在（不存在则创建私有仓库）→ 连接。
   */
  connectGithubOneClick(token: string): Promise<void>;
  /** 断开（清空） */
  disconnect(): void;
  /** 全量刷新（账本/账户/分类/交易） */
  refreshAll(): Promise<void>;
  addTransactions(list: Transaction[]): Promise<AddResult>;
  /** 存量未分类的收支交易按商户名自动补分类，返回 { updated, unmatched } */
  autoCategorizeUncategorized(): Promise<{ updated: number; unmatched: number }>;
  updateTransaction(tx: Transaction): Promise<void>;
  removeTransaction(id: string): Promise<void>;
  saveAccounts(accounts: Account[]): Promise<void>;
  saveCategories(categories: Category[]): Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  status: 'unconfigured',
  error: null,
  config: null,
  repo: null,
  ledger: null,
  accounts: [],
  categories: [],
  transactions: [],
  months: [],

  async connect(config) {
    const attempt = ++connectionAttempt;
    set({ status: 'connecting', error: null, config });
    try {
      // local 模式：数据目录由主进程决定（userData/ledger-data）
      let effective = config;
      if (config.kind === 'local') {
        const root = await window.acLedgerDesktop?.storage.rootDir();
        effective = { kind: 'local', rootDir: root ?? config.rootDir };
      }
      const adapter = createAdapter(effective);
      await adapter.testConnection();
      const repo = new LedgerRepository(adapter);
      await repo.initLedger({ name: '我的账本' });
      const [ledger, accounts, categories, transactions, months] = await Promise.all([
        repo.getLedger(),
        repo.getAccounts(),
        repo.getCategories(),
        repo.getTransactions(),
        repo.listMonths(),
      ]);
      if (attempt !== connectionAttempt) return;
      saveConfig(effective);
      set({
        config: effective,
        repo,
        ledger,
        accounts,
        categories,
        transactions,
        months,
        status: 'ready',
        error: null,
      });
    } catch (e) {
      const message = e instanceof StorageError || e instanceof Error ? e.message : String(e);
      if (attempt === connectionAttempt) {
        set({ status: 'error', error: message, repo: null, ledger: null });
      }
      throw e;
    }
  },

  async connectGithubOneClick(token: string) {
    set({ status: 'connecting', error: null });
    try {
      const user = await fetchGithubUser(token);
      await ensureLedgerRepo(token, user.login, 'ac-ledger-data');
      await get().connect({
        kind: 'github',
        owner: user.login,
        repo: 'ac-ledger-data',
        token,
      });
    } catch (e) {
      const message = e instanceof StorageError || e instanceof Error ? e.message : String(e);
      set({ status: 'error', error: message });
      throw e;
    }
  },

  disconnect() {
    connectionAttempt++;
    saveConfig(null);
    set({
      status: 'unconfigured',
      error: null,
      config: null,
      repo: null,
      ledger: null,
      accounts: [],
      categories: [],
      transactions: [],
      months: [],
    });
  },

  async refreshAll() {
    const { repo } = get();
    if (!repo) return;
    const [ledger, accounts, categories, transactions, months] = await Promise.all([
      repo.getLedger(),
      repo.getAccounts(),
      repo.getCategories(),
      repo.getTransactions(),
      repo.listMonths(),
    ]);
    set({ ledger, accounts, categories, transactions, months });
  },

  async addTransactions(list) {
    const { repo } = get();
    if (!repo) throw new Error('尚未连接数据源');
    const result = await repo.addTransactions(list);
    await get().refreshAll();
    return result;
  },

  async autoCategorizeUncategorized() {
    const { repo, transactions, categories } = get();
    if (!repo) throw new Error('尚未连接数据源');
    const uncategorized = transactions.filter(
      (t) => !t.categoryId && (t.type === 'income' || t.type === 'expense')
    );
    if (uncategorized.length === 0) return { updated: 0, unmatched: 0 };
    const after = applyAutoCategory(transactions, categories);
    const byId = new Map(transactions.map((t) => [t.id, t]));
    const changed = after.filter((t) => byId.get(t.id)?.categoryId !== t.categoryId);
    if (changed.length > 0) await repo.updateTransactions(changed);
    await get().refreshAll();
    return { updated: changed.length, unmatched: uncategorized.length - changed.length };
  },

  async updateTransaction(tx) {
    const { repo } = get();
    if (!repo) throw new Error('尚未连接数据源');
    await repo.updateTransaction(tx);
    await get().refreshAll();
  },

  async removeTransaction(id) {
    const { repo } = get();
    if (!repo) throw new Error('尚未连接数据源');
    await repo.removeTransaction(id);
    await get().refreshAll();
  },

  async saveAccounts(accounts) {
    const { repo } = get();
    if (!repo) throw new Error('尚未连接数据源');
    await repo.saveAccounts(accounts);
    set({ accounts });
  },

  async saveCategories(categories) {
    const { repo } = get();
    if (!repo) throw new Error('尚未连接数据源');
    await repo.saveCategories(categories);
    set({ categories });
  },
}));

/** 启动时尝试用保存的配置自动连接 */
export async function autoConnect(): Promise<void> {
  if (autoConnectPromise) return autoConnectPromise;
  autoConnectPromise = (async () => {
    const saved = loadSavedConfig();
    if (!saved) return;
    const { connect } = useStore.getState();
    try {
      await connect(saved);
    } catch {
      // 失败保留错误状态，用户可重新配置
    }
  })();
  return autoConnectPromise;
}
