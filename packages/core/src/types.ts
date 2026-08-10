/**
 * Ac记账核心数据模型。
 *
 * 数据文件在仓库中的布局：
 * ```
 * <仓库根>/
 * ├── ledger.json          # 账本元数据
 * ├── accounts.json        # 账户列表
 * ├── categories.json      # 分类列表
 * ├── settings.json        # 同步设置等
 * └── transactions/
 *     └── 2026-08.json     # 交易按月分片（YYYY-MM.json）
 * ```
 */

/** 交易方向 */
export type TransactionType = 'income' | 'expense' | 'transfer' | 'neutral';

/** 交易状态 */
export type TransactionStatus =
  | 'pending' // 处理中
  | 'completed' // 成功
  | 'refunded' // 已退款（全额）
  | 'partially_refunded' // 已部分退款
  | 'failed'; // 失败

export interface Transaction {
  /** 本地唯一 ID（UUID） */
  id: string;
  /** 交易时间，ISO 8601 字符串，东八区本地时间，如 "2026-08-10T07:17:06+08:00" */
  date: string;
  type: TransactionType;
  /** 金额，恒为正数，单位：元（人民币等），展示层负责格式化 */
  amount: number;
  /** ISO 4217 货币代码，默认 "CNY" */
  currency: string;
  /** 分类 ID；未分类为 null */
  categoryId: string | null;
  /** 账户 ID（零钱、储蓄卡…）；未知为 null */
  accountId: string | null;
  /** 交易对方（昵称/商户名） */
  counterparty: string;
  /** 备注/商品描述 */
  note: string;
  status: TransactionStatus;
  /** 来源：'manual' | 'wechat' | 'alipay' … */
  source: string;
  /** 原始凭证号（如微信交易单号），用于跨文件去重 */
  refId?: string;
  createdAt: string;
  updatedAt: string;
}

export type AccountType =
  | 'cash' // 现金
  | 'bank' // 银行卡
  | 'ewallet' // 电子钱包（零钱等）
  | 'credit' // 信用卡
  | 'investment'; // 理财/投资

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  /** 可选：账户当前余额（展示用，不参与流水计算） */
  balance?: number;
  note?: string;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  /** 收入分类或支出分类 */
  kind: 'income' | 'expense';
  /** 父分类 ID；null 为顶级分类 */
  parentId: string | null;
  icon?: string;
  sortOrder: number;
}

/** 账本 = 一个数据源（一个 GitHub 仓库目录 / 一个 WebDAV 目录） */
export interface Ledger {
  id: string;
  name: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

/** 数据仓库整体元数据（仓库根目录的 ledger.json） */
export interface LedgerFile {
  /** 文件格式版本，当前为 1 */
  version: 1;
  ledger: Ledger;
}

/** 按月分片交易文件内容 */
export interface TransactionsFile {
  version: 1;
  /** 月份 "2026-08" */
  month: string;
  transactions: Transaction[];
}

/** 账户文件内容 */
export interface AccountsFile {
  version: 1;
  accounts: Account[];
}

/** 分类文件内容 */
export interface CategoriesFile {
  version: 1;
  categories: Category[];
}
