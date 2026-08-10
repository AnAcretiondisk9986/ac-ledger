/**
 * 支付宝账单解析（个人版 CSV，GBK 编码）。
 *
 * 文件结构（真实样本 618 行数据）：
 * R1  支付宝交易记录明细查询
 * R2  账号:[xxx]
 * R3  起始日期:[...]    终止日期:[...]
 * R4  ---------------------------------交易记录明细列表------------------------------------
 * R5  表头：交易号,商家订单号,交易创建时间,付款时间,最近修改时间,交易来源地,类型,交易对方,商品名称,金额（元）,收/支,交易状态,服务费（元）,成功退款（元）,备注,资金状态
 * R6+ 数据行（逗号分隔，值两侧带 padding 空格/tab 补齐列宽，无引号包裹）
 * 尾部汇总：已支出:N笔,x元 / 待支出:N笔,x元 / 导出时间:[...] 用户:xxx
 *
 * 与微信账单的关键差异：
 * - GBK 编码（非 UTF-8）
 * - 16 列（非 11 列）
 * - 收/支 取值为「收入/支出/不计收支」（中性交易叫「不计收支」）
 * - 统计信息在文件尾部（微信在头部）
 * - 值带 padding，必须 trim
 */

import { Transaction, TransactionStatus, TransactionType, uuid } from '@ac-ledger/core';
import { BillParseOptions, BillParseResult, AlipayBillSummary } from '../types.js';

export const ALIPAY_HEADER_COLUMNS = [
  '交易号',
  '商家订单号',
  '交易创建时间',
  '付款时间',
  '最近修改时间',
  '交易来源地',
  '类型',
  '交易对方',
  '商品名称',
  '金额（元）',
  '收/支',
  '交易状态',
  '服务费（元）',
  '成功退款（元）',
  '备注',
  '资金状态',
] as const;

export interface AlipayRawRow {
  tradeNo: string;
  merchantNo: string;
  /** 交易创建时间 "2026-08-09 20:16:09" */
  createTime: string;
  payTime: string;
  modifyTime: string;
  origin: string;
  type: string;
  counterparty: string;
  goods: string;
  amount: string;
  inOut: string;
  status: string;
  fee: string;
  refund: string;
  remark: string;
  fundStatus: string;
}

/** 支付宝尾部汇总 */
export type { BillParseOptions as AlipayParseOptions, BillParseResult as AlipayParseResult };

/** 支付宝尾部汇总（别名，兼容旧名） */
export type AlipaySummary = AlipayBillSummary;

/**
 * 归一化：trim 所有单元格；若字段值内嵌逗号（未引号包裹）导致列数超过 16，
 * 把 index 8（商品名称）到倒数第 8 列之间的片段合并回商品名称。
 * 注：支付宝导出的行尾有逗号，会多出 1 个空 cell，因此数据列为 cells[0..15]，
 * 商品名称区间为 [8, n-8)。
 */
export function normalizeAlipayCells(cells: string[]): string[] {
  if (cells.length <= 16) return cells.map((c) => c.trim());
  const n = cells.length;
  const goods = cells.slice(8, n - 8).join(',').trim();
  const head = cells.slice(0, 8).map((c) => c.trim());
  const tail = cells.slice(n - 8).map((c) => c.trim());
  return [...head, goods, ...tail];
}

/** 文本行 → 归一化后的单元格数组 */
export function splitAlipayRow(line: string): string[] {
  return normalizeAlipayCells(line.split(','));
}

/** 从拆分后的单元格数组构建 RawRow；非数据行（表头/汇总/空行）返回 null */
export function rowFromAlipayCells(cells: string[]): AlipayRawRow | null {
  const normalized = normalizeAlipayCells(cells);
  if (normalized.length < 16) return null;
  if (!normalized[0] || !normalized[0].trim()) return null;
  const get = (i: number): string => (normalized[i] ?? '').trim();
  return {
    tradeNo: get(0),
    merchantNo: get(1),
    createTime: get(2),
    payTime: get(3),
    modifyTime: get(4),
    origin: get(5),
    type: get(6),
    counterparty: get(7),
    goods: get(8),
    amount: get(9),
    inOut: get(10),
    status: get(11),
    fee: get(12),
    refund: get(13),
    remark: get(14),
    fundStatus: get(15),
  };
}

/** 文本行 → RawRow（兼容直接处理原始文本行） */
export function rowFromAlipayLine(line: string): AlipayRawRow | null {
  if (!line.trim()) return null;
  return rowFromAlipayCells(splitAlipayRow(line));
}

/** 收/支 → TransactionType（不计收支 → neutral） */
export function mapAlipayType(inOut: string): TransactionType {
  if (inOut === '收入') return 'income';
  if (inOut === '支出') return 'expense';
  return 'neutral'; // 不计收支 / 其他
}

/** 交易状态 + 成功退款金额 → TransactionStatus */
export function mapAlipayStatus(status: string, refundAmount: string): TransactionStatus {
  if (status === '退款成功') return 'refunded';
  if (status === '交易关闭') return 'failed';
  const refund = parseFloat(refundAmount);
  if (Number.isFinite(refund) && refund > 0) return 'partially_refunded';
  return 'completed';
}

/** 解析尾部汇总行 */
export function parseAlipaySummary(metaLines: string[]): AlipayBillSummary {
  const summary: AlipayBillSummary = {};
  for (const line of metaLines) {
    const income = line.match(/已收入:(\d+)笔,([\d.]+)元/);
    if (income) {
      summary.incomeCount = Number(income[1]);
      summary.incomeAmount = Number(income[2]);
      continue;
    }
    const pendingIncome = line.match(/待收入:(\d+)笔,([\d.]+)元/);
    if (pendingIncome) {
      summary.pendingIncomeCount = Number(pendingIncome[1]);
      summary.pendingIncomeAmount = Number(pendingIncome[2]);
      continue;
    }
    const paid = line.match(/已支出:(\d+)笔,([\d.]+)元/);
    if (paid) {
      summary.paidCount = Number(paid[1]);
      summary.paidAmount = Number(paid[2]);
      continue;
    }
    const pending = line.match(/待支出:(\d+)笔,([\d.]+)元/);
    if (pending) {
      summary.pendingCount = Number(pending[1]);
      summary.pendingAmount = Number(pending[2]);
      continue;
    }
    const exportTime = line.match(/导出时间:\[(.*?)\]/);
    if (exportTime) summary.exportTime = exportTime[1]?.trim();
    const user = line.match(/用户:(.*)$/);
    if (user) summary.user = user[1]?.trim();
  }
  return summary;
}

/** 原始行 → Transaction */
export function alipayRowToTransaction(row: AlipayRawRow, opts: BillParseOptions): Transaction {
  const amount = parseFloat(row.amount);
  // 创建时间为空时退回付款时间
  const time = (row.createTime || row.payTime).replace(' ', 'T') + '+08:00';
  return {
    id: uuid(),
    date: time,
    type: mapAlipayType(row.inOut),
    amount: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0,
    currency: 'CNY',
    categoryId: opts.defaultCategoryId ?? null,
    accountId: null,
    counterparty: row.counterparty,
    note: [row.goods, row.remark].filter((p) => p).join(' | '),
    status: mapAlipayStatus(row.status, row.refund),
    source: opts.source ?? 'alipay',
    refId: row.tradeNo || undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** 核心解析：数据行 → 交易列表 */
export function parseAlipayRows(rows: AlipayRawRow[], opts: BillParseOptions = {}): BillParseResult {
  const transactions: Transaction[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (!row.createTime && !row.payTime) {
      skipped++;
      continue;
    }
    transactions.push(alipayRowToTransaction(row, opts));
  }
  return { transactions, skipped };
}
