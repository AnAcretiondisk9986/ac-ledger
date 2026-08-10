import type { Transaction } from './types.js';
import { sumYuan } from './money.js';

/** 从 ISO 日期取月份键 "YYYY-MM" */
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** 从 ISO 日期取年份 */
export function yearOf(isoDate: string): number {
  return Number(isoDate.slice(0, 4));
}

/** 收支汇总 */
export interface Summary {
  income: number;
  expense: number;
  /** 结余 = 收入 - 支出（不含转账/中性） */
  balance: number;
  transfer: number;
  neutral: number;
  count: number;
}

export function summarize(transactions: Transaction[]): Summary {
  let income = 0;
  let expense = 0;
  let transfer = 0;
  let neutral = 0;
  for (const tx of transactions) {
    switch (tx.type) {
      case 'income':
        income += tx.amount;
        break;
      case 'expense':
        expense += tx.amount;
        break;
      case 'transfer':
        transfer += tx.amount;
        break;
      case 'neutral':
        neutral += tx.amount;
        break;
    }
  }
  return {
    income: round(income),
    expense: round(expense),
    balance: round(income - expense),
    transfer: round(transfer),
    neutral: round(neutral),
    count: transactions.length,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 按分类聚合支出/收入金额 */
export function categoryBreakdown(
  transactions: Transaction[],
  kind: 'income' | 'expense'
): Map<string, number> {
  const map = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.type !== kind) continue;
    const key = tx.categoryId ?? 'uncategorized';
    map.set(key, (map.get(key) ?? 0) + tx.amount);
  }
  return map;
}

/** 按交易对方聚合（笔数 + 金额），按金额降序排列 */
export function counterpartyBreakdown(
  transactions: Transaction[],
  kind: 'income' | 'expense'
): { name: string; count: number; amount: number }[] {
  const map = new Map<string, { count: number; amount: number }>();
  for (const tx of transactions) {
    if (tx.type !== kind) continue;
    const name = tx.counterparty.trim() || '（无对方）';
    const entry = map.get(name) ?? { count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += tx.amount;
    map.set(name, entry);
  }
  return [...map.entries()]
    .map(([name, v]) => ({ name, count: v.count, amount: round(v.amount) }))
    .sort((a, b) => b.amount - a.amount);
}

/** 按月份聚合（用于趋势图），返回 { month, income, expense }[] */
export function monthlySeries(
  transactions: Transaction[],
  fromMonth: string,
  toMonth: string
): { month: string; income: number; expense: number }[] {
  const byMonth = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    const m = monthKey(tx.date);
    if (m < fromMonth || m > toMonth) continue;
    const list = byMonth.get(m) ?? [];
    list.push(tx);
    byMonth.set(m, list);
  }
  const result: { month: string; income: number; expense: number }[] = [];
  let cursor = fromMonth;
  while (cursor <= toMonth) {
    const list = byMonth.get(cursor) ?? [];
    const s = summarize(list);
    result.push({ month: cursor, income: s.income, expense: s.expense });
    cursor = nextMonth(cursor);
  }
  return result;
}

/** 月份递增，返回下个月 "YYYY-MM" */
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 当前月份键（东八区） */
export function currentMonth(): string {
  const d = new Date();
  const utc8 = new Date(d.getTime() + 8 * 3600 * 1000);
  return `${utc8.getUTCFullYear()}-${String(utc8.getUTCMonth() + 1).padStart(2, '0')}`;
}
